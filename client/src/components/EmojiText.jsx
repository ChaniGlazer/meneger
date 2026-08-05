import { splitEmoji, emojiSrc } from "../emoji";

// Trailing punctuation is excluded from the match so "(see example.com)."
// doesn't swallow the closing paren/period into the link.
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,!?;:'")\]}]|www\.[^\s<]+[^\s<.,!?;:'")\]}])/gi;

function renderTextWithEmoji(text, keyPrefix) {
  const parts = splitEmoji(text);
  return parts.map((part, i) =>
    typeof part === "string" ? (
      part
    ) : (
      <img
        key={`${keyPrefix}-${i}`}
        className="emoji"
        src={emojiSrc(part.codepoints)}
        alt={part.char}
        draggable="false"
      />
    )
  );
}

export default function EmojiText({ text }) {
  if (!text) return null;

  const segments = text.split(URL_RE);
  // A single-capture-group split alternates plain text / matched URL / plain text / ...
  return segments.map((segment, i) => {
    const isUrl = i % 2 === 1;
    if (isUrl) {
      const href = segment.startsWith("http") ? segment : `https://${segment}`;
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {renderTextWithEmoji(segment, i)}
        </a>
      );
    }
    return renderTextWithEmoji(segment, i);
  });
}
