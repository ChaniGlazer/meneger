import { splitEmoji, emojiSrc } from "../emoji";

export default function EmojiText({ text }) {
  const parts = splitEmoji(text);
  return parts.map((part, i) =>
    typeof part === "string" ? (
      part
    ) : (
      <img
        key={i}
        className="emoji"
        src={emojiSrc(part.codepoints)}
        alt={part.char}
        draggable="false"
      />
    )
  );
}
