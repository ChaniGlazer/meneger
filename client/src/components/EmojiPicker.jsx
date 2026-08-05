import { useState } from "react";
import { EMOJI_PICKER_LIST, emojiSrc } from "../emoji";

const RECENTS_KEY = "recentEmoji";
const MAX_RECENTS = 8;

function loadRecents() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    return raw.filter((cp) => EMOJI_PICKER_LIST.some((e) => e.codepoints === cp));
  } catch {
    return [];
  }
}

function saveRecents(codepoints) {
  const next = [codepoints, ...loadRecents().filter((cp) => cp !== codepoints)].slice(
    0,
    MAX_RECENTS
  );
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  return next;
}

function EmojiGrid({ items, onSelect }) {
  return (
    <div className="emoji-picker-grid">
      {items.map(({ codepoints, char }) => (
        <button
          key={codepoints}
          type="button"
          className="emoji-picker-item"
          aria-label={char}
          onClick={() => onSelect(codepoints, char)}
        >
          <img className="emoji" src={emojiSrc(codepoints)} alt={char} draggable="false" />
        </button>
      ))}
    </div>
  );
}

export default function EmojiPicker({ onSelect }) {
  const [recents, setRecents] = useState(loadRecents);

  const handleSelect = (codepoints, char) => {
    setRecents(saveRecents(codepoints));
    onSelect(char);
  };

  const recentItems = recents
    .map((cp) => EMOJI_PICKER_LIST.find((e) => e.codepoints === cp))
    .filter(Boolean);

  return (
    <div className="emoji-picker">
      {recentItems.length > 0 && (
        <>
          <div className="emoji-picker-label">לאחרונה</div>
          <EmojiGrid items={recentItems} onSelect={handleSelect} />
          <div className="emoji-picker-divider" />
        </>
      )}
      <EmojiGrid items={EMOJI_PICKER_LIST} onSelect={handleSelect} />
    </div>
  );
}
