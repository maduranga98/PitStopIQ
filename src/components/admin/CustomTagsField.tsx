import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import {
  MAX_CUSTOM_TAGS, MAX_CUSTOM_TAG_LENGTH, normalizeCustomTags,
} from "../../types/leads";
import { inputClass } from "./AdminModal";

/**
 * Chip editor for a lead's custom tags. Tags already in use elsewhere are
 * offered as one-tap suggestions (most-used first), so the common tag most
 * leads share is a single click rather than retyping it.
 */
export default function CustomTagsField({
  value, onChange, suggestions = [], disabled,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Tags in use across the board, most-used first. */
  suggestions?: string[];
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const full = value.length >= MAX_CUSTOM_TAGS;
  const have = new Set(value.map((t) => t.toLowerCase()));
  const offered = suggestions.filter((s) => !have.has(s.toLowerCase())).slice(0, 6);

  const add = (raw: string) => {
    const next = normalizeCustomTags([...value, ...raw.split(",")]);
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };
  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (draft.trim()) add(draft);
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      remove(value[value.length - 1]);
    }
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full text-xs font-medium bg-orange-500/15 text-orange-300 border border-orange-500/30"
            >
              {tag}
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(tag)}
                aria-label={`Remove ${tag}`}
                className="p-0.5 rounded-full hover:bg-orange-500/20 disabled:opacity-40"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className={inputClass}
        value={draft}
        disabled={disabled || full}
        maxLength={MAX_CUSTOM_TAG_LENGTH}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={full ? `Up to ${MAX_CUSTOM_TAGS} tags` : "Type a tag, press Enter"}
      />
      {!full && offered.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {offered.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => add(s)}
              className="px-2.5 py-0.5 rounded-full text-xs bg-gray-950 border border-gray-800 text-gray-500 hover:text-gray-200 hover:border-gray-700 transition-colors disabled:opacity-40"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Read-only chips, for cards, the list and the drawer header. */
export function CustomTagChips({ tags, className = "" }: { tags?: string[]; className?: string }) {
  return (
    <>
      {(tags ?? []).map((t) => (
        <span
          key={t}
          className={`font-medium rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/30 flex-shrink-0 ${className}`}
        >
          {t}
        </span>
      ))}
    </>
  );
}
