import { parse as parseEmoji } from "twemoji-parser";
import emojiManifest from "./emojiManifest.json";

const AVAILABLE = new Set(emojiManifest);

function codepointsFromUrl(url) {
  return url.split("/").pop().replace(".svg", "");
}

// Splits text into an array of strings and emoji descriptors so callers can
// render each emoji as a self-hosted Twemoji image instead of the OS's
// built-in emoji font. Emoji outside our self-hosted set fall back to the
// native character rather than breaking.
export function splitEmoji(text) {
  if (!text) return [text];
  const matches = parseEmoji(text, { assetType: "svg" });
  if (matches.length === 0) return [text];

  const parts = [];
  let cursor = 0;
  for (const match of matches) {
    const [start, end] = match.indices;
    const codepoints = codepointsFromUrl(match.url);
    if (start > cursor) parts.push(text.slice(cursor, start));
    if (AVAILABLE.has(codepoints)) {
      parts.push({ emoji: true, codepoints, char: match.text });
    } else {
      parts.push(match.text);
    }
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function emojiSrc(codepoints) {
  return `/emoji/svg/${codepoints}.svg`;
}
