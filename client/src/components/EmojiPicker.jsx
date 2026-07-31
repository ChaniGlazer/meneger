import { EMOJI_PICKER_LIST, emojiSrc } from "../emoji";

export default function EmojiPicker({ onSelect }) {
  return (
    <div className="emoji-picker-grid">
      {EMOJI_PICKER_LIST.map(({ codepoints, char }) => (
        <button
          key={codepoints}
          type="button"
          className="emoji-picker-item"
          aria-label={char}
          onClick={() => onSelect(char)}
        >
          <img className="emoji" src={emojiSrc(codepoints)} alt={char} draggable="false" />
        </button>
      ))}
    </div>
  );
}
