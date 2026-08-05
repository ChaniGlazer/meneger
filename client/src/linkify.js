// Trailing punctuation is excluded from the match so "(see example.com)."
// doesn't swallow the closing paren/period into the link.
export const URL_RE =
  /(https?:\/\/[^\s<]+[^\s<.,!?;:'")\]}]|www\.[^\s<]+[^\s<.,!?;:'")\]}])/gi;

export function firstUrl(text) {
  if (!text) return null;
  const match = text.match(URL_RE);
  if (!match) return null;
  const url = match[0];
  return url.startsWith("http") ? url : `https://${url}`;
}
