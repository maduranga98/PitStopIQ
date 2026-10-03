import { Check, Minus, Wrench } from "lucide-react";
import type { InspectionResultStatus } from "../../types/inspectionReports";

const OPTIONS: { value: InspectionResultStatus; label: string; icon: typeof Check; on: string }[] = [
  { value: "meets", label: "Meets", icon: Check, on: "bg-green-500/15 border-green-500/50 text-green-300" },
  { value: "needs_repair", label: "Repair", icon: Wrench, on: "bg-red-500/15 border-red-500/50 text-red-300" },
  { value: "na", label: "N/A", icon: Minus, on: "bg-white/10 border-white/30 text-gray-200" },
];

/** Meets / Needs repair / N/A. Tapping the active answer again clears it. */
export default function ResultButtons({
  value, onChange, disabled,
}: {
  value: InspectionResultStatus | null;
  onChange: (next: InspectionResultStatus | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1.5" role="group" aria-label="Result">
      {OPTIONS.map(({ value: v, label, icon: Icon, on }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(active ? null : v)}
            className={`flex-1 flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors disabled:opacity-60 ${
              active ? on : "border-white/10 text-gray-400 hover:border-white/25 hover:text-gray-200"
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        );
      })}
    </div>
  );
}
