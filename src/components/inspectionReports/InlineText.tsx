import { useEffect, useRef, useState } from "react";
import { MAX_TEMPLATE_LABEL_LENGTH } from "../../constants/inspectionReports";

/** Text that turns into an input on tap. Enter / blur saves, Escape cancels. */
export default function InlineText({
  value, onSave, className = "", disabled = false, placeholder,
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onSave(next);
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setDraft(value); setEditing(true); }}
        className={`text-left min-w-0 ${disabled ? "cursor-default" : "hover:text-white cursor-text"} ${className}`}
      >
        {value || <span className="text-gray-600">{placeholder}</span>}
      </button>
    );
  }
  return (
    <input
      ref={inputRef}
      autoFocus
      value={draft}
      maxLength={MAX_TEMPLATE_LABEL_LENGTH}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className={`min-w-0 w-full bg-[#0B1120] border border-[#F97316]/60 rounded-md px-2 py-1 text-sm text-white focus:outline-none ${className}`}
    />
  );
}
