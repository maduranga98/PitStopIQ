import { useState } from "react";

interface Props {
  /** The committed numeric value. */
  value: number;
  /** Raw input text, so callers keep parsing it exactly as they did before. */
  onChange: (raw: string) => void;
  disabled?: boolean;
  min?: string;
  step?: string;
  className?: string;
  placeholder?: string;
  title?: string;
}

/**
 * A number box that gets out of the way when it holds nothing.
 *
 * A fresh line starts at 0, and on the counter that 0 had to be deleted before
 * a price could be typed — every single row. Focusing a box that reads 0 now
 * empties it, and leaving it empty puts the 0 back, so nothing is lost if the
 * user tabs away. A box with a real figure in it selects that figure instead,
 * so typing replaces it and one arrow key still edits it.
 */
export default function AmountInput({
  value, onChange, disabled, min = "0", step = "0.01", className, placeholder, title,
}: Props) {
  // Non-null only while the field is focused — the local text the user is
  // typing, which may legitimately be "" or "12." mid-keystroke.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="number"
      inputMode="decimal"
      value={draft ?? String(value)}
      min={min}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      title={title}
      className={className}
      onFocus={(e) => {
        if (value === 0) setDraft("");
        else e.currentTarget.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
      onBlur={() => setDraft(null)}
      // A stray scroll over a focused number box silently changes the price.
      onWheel={(e) => e.currentTarget.blur()}
    />
  );
}
