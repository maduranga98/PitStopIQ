import { Star } from "lucide-react";
import { MAX_RATING } from "../../types/leads";

/**
 * Five stars. Read-only by default (a single compact glyph + number when
 * `compact`), interactive when `onChange` is given — tapping the star that is
 * already selected clears the rating.
 */
export default function StarRating({
  value, onChange, compact = false, disabled = false, className = "",
}: {
  value: number;
  onChange?: (rating: number) => void;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  if (compact) {
    // Unrated leads show nothing: a row of empty stars on every card is noise.
    if (value < 1) return null;
    return (
      <span
        title={`Rated ${value} of ${MAX_RATING}`}
        className={`inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-300 flex-shrink-0 ${className}`}
      >
        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
        {value}
      </span>
    );
  }

  return (
    <div className={`inline-flex items-center gap-0.5 ${className}`} role="radiogroup" aria-label="Customer rating">
      {Array.from({ length: MAX_RATING }, (_, i) => i + 1).map((n) => {
        const on = n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            disabled={disabled || !onChange}
            onClick={() => onChange?.(n === value ? 0 : n)}
            className="p-0.5 rounded transition-transform enabled:hover:scale-110 disabled:cursor-default focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-500"
          >
            <Star className={`w-5 h-5 ${on ? "fill-amber-400 text-amber-400" : "text-gray-700"}`} />
          </button>
        );
      })}
    </div>
  );
}
