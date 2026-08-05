const dns = require("dns").promises;
const net = require("net");

const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 300_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map(); // url -> { data, expires }

function isBlockedIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 127 || // loopback
      a === 10 || // private
      a === 0 ||
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) // private
    );
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fe80:") || // link-local
      lower.startsWith("fc") ||
      lower.startsWith("fd") // unique local
    );
  }
  return true; // not a valid IP — reject
}

async function assertPublicHost(hostname) {
  const addresses = await dns.lookup(hostname, { all: true });
  if (addresses.length === 0) throw new Error("no address");
  for (const { address } of addresses) {
    if (isBlockedIp(address)) throw new Error("blocked address");
  }
}

function resolveUrl(base, maybeRelative) {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return null;
  }
}

function extractMeta(html, baseUrl) {
  const metaTag = (attr, key) => {
    const re = new RegExp(
      `<meta[^>]+${attr}=["']${key}["'][^>]*>`,
      "i"
    );
    const match = html.match(re);
    if (!match) return null;
    const contentMatch = match[0].match(/content=["']([^"']*)["']/i);
    return contentMatch ? contentMatch[1] : null;
  };

  const title =
    metaTag("property", "og:title") ||
    metaTag("name", "twitter:title") ||
    (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] ||
    null;

  const description =
    metaTag("property", "og:description") ||
    metaTag("name", "twitter:description") ||
    metaTag("name", "description") ||
    null;

  let image =
    metaTag("property", "og:image") || metaTag("name", "twitter:image") || null;
  if (image) image = resolveUrl(baseUrl, image);

  const siteName = metaTag("property", "og:site_name") || new URL(baseUrl).hostname;

  return {
    title: title ? title.trim().slice(0, 200) : null,
    description: description ? description.trim().slice(0, 300) : null,
    image,
    siteName,
  };
}

// Fetches a page server-side and extracts OpenGraph/Twitter-card metadata for
// a link-preview card. Blocks loopback/private/link-local targets (including
// the cloud metadata IP) so a logged-in user can't use this as an SSRF probe
// against internal infrastructure.
async function fetchLinkPreview(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error("כתובת לא תקינה"), { status: 400 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw Object.assign(new Error("כתובת לא תקינה"), { status: 400 });
  }

  const cached = cache.get(url.toString());
  if (cached && cached.expires > Date.now()) return cached.data;

  await assertPublicHost(url.hostname).catch(() => {
    throw Object.assign(new Error("כתובת חסומה"), { status: 400 });
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ChatLinkPreview/1.0)" },
    });
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok || !contentType.includes("text/html")) {
      const data = { url: url.toString(), title: null, description: null, image: null, siteName: url.hostname };
      cache.set(url.toString(), { data, expires: Date.now() + CACHE_TTL_MS });
      return data;
    }

    const reader = res.body.getReader();
    let received = 0;
    let html = "";
    const decoder = new TextDecoder();
    while (received < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      html += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});

    const data = { url: url.toString(), ...extractMeta(html, url.toString()) };
    cache.set(url.toString(), { data, expires: Date.now() + CACHE_TTL_MS });
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { fetchLinkPreview };
