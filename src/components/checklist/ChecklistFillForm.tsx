// The sectioned post-service checklist as it is filled in — and, read-only, as
// it reads back once signed off. One component for the job-tied runner, the
// standalone page and the report, so a line looks the same everywhere.
//
// Each line takes one of three results (green / yellow / red on the printed
// sheet). The colours are never the only signal: every button carries an icon
// and a text label for assistive tech, and the chosen result is spelled out.
import { useState } from "react";
import { AlertTriangle, Check, CheckCheck, OctagonAlert } from "lucide-react";
import type {
  ChecklistResult, FilledChecklistItem, FilledChecklistSection,
} from "../../types/auth";
import { CHECKLIST_RESULT_LABELS } from "../../types/auth";
import {
  MAX_REMARKS, MAX_TECHNICIAN_NAME, markRemainingOk, parseReading, patchFilledItem, ratedProgress,
} from "../../lib/checklistFill";

const RESULT_STYLE: Record<ChecklistResult, { on: string; icon: React.ElementType; short: string }> = {
  ok: { on: "bg-green-500/20 border-green-500/50 text-green-300", icon: Check, short: "OK" },
  attention: { on: "bg-yellow-500/20 border-yellow-500/50 text-yellow-300", icon: AlertTriangle, short: "Watch" },
  immediate: { on: "bg-red-500/20 border-red-500/50 text-red-300", icon: OctagonAlert, short: "Urgent" },
};
const RESULTS: ChecklistResult[] = ["ok", "attention", "immediate"];

interface Props {
  sections: FilledChecklistSection[];
  onChange?: (next: FilledChecklistSection[]) => void;
  remarks: string;
  onRemarksChange?: (next: string) => void;
  /** Signed-off records, or a person who may look but not fill. */
  readOnly?: boolean;
  disabled?: boolean;
}

export default function ChecklistFillForm({
  sections, onChange, remarks, onRemarksChange, readOnly = false, disabled = false,
}: Props) {
  const locked = readOnly || disabled;
  const patch = (sectionId: string, itemId: string, p: Parameters<typeof patchFilledItem>[3]) =>
    onChange?.(patchFilledItem(sections, sectionId, itemId, p));

  return (
    <div className="space-y-5">
      {sections.map((section) => {
        const { done, total } = ratedProgress([section]);
        return (
          <section key={section.id} aria-label={section.title} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-xs uppercase tracking-wider font-semibold text-gray-300">{section.title}</h4>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-xs text-gray-500 tabular-nums">{done}/{total}</span>
                {!locked && done < total && (
                  <button
                    type="button"
                    onClick={() => onChange?.(markRemainingOk(sections, section.id))}
                    className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1"
                  >
                    <CheckCheck className="w-3.5 h-3.5" /> Rest OK
                  </button>
                )}
              </div>
            </div>

            <div className="divide-y divide-white/5 border border-white/10 rounded-xl bg-white/[0.02]">
              {section.items.map((item) => (
                <Line
                  key={item.id}
                  item={item}
                  showTechnician={section.hasTechnician}
                  locked={locked}
                  readOnly={readOnly}
                  onPatch={(p) => patch(section.id, item.id, p)}
                />
              ))}
            </div>
          </section>
        );
      })}

      <div className="space-y-1.5">
        <label className="text-xs uppercase tracking-wider font-semibold text-gray-300" htmlFor="checklist-remarks">
          Remarks
        </label>
        {readOnly ? (
          <p className="text-sm text-gray-300 whitespace-pre-wrap">{remarks.trim() || "—"}</p>
        ) : (
          <>
            <textarea
              id="checklist-remarks"
              value={remarks}
              onChange={(e) => onRemarksChange?.(e.target.value.slice(0, MAX_REMARKS))}
              disabled={disabled}
              rows={3}
              placeholder="Anything the customer should know"
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 disabled:opacity-50 resize-none"
            />
            <p className="text-xs text-gray-600">{remarks.length}/{MAX_REMARKS}</p>
          </>
        )}
      </div>
    </div>
  );
}

function Line({ item, showTechnician, locked, readOnly, onPatch }: {
  item: FilledChecklistItem;
  showTechnician: boolean;
  locked: boolean;
  readOnly: boolean;
  onPatch: (p: Partial<Pick<FilledChecklistItem, "status" | "value" | "technicianName">>) => void;
}) {
  const numeric = item.type === "status_numeric";
  return (
    <div className="px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-white min-w-0">{item.label}</span>
        {readOnly ? <ResultChip status={item.status} /> : (
          <div role="radiogroup" aria-label={`${item.label} result`} className="flex items-center gap-1.5 flex-shrink-0">
            {RESULTS.map((r) => {
              const on = item.status === r;
              const { icon: Icon, on: onClass, short } = RESULT_STYLE[r];
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={CHECKLIST_RESULT_LABELS[r]}
                  title={CHECKLIST_RESULT_LABELS[r]}
                  disabled={locked}
                  // Tapping the chosen result again clears it.
                  onClick={() => onPatch({ status: on ? null : r })}
                  className={`h-8 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition disabled:opacity-50 ${
                    on ? onClass : "bg-white/5 border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {on && <span>{short}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {(numeric || showTechnician) && (
        <div className="flex items-center gap-2 flex-wrap">
          {numeric && (readOnly ? (
            <span className="text-xs text-gray-300 tabular-nums">
              {item.value !== null ? `${item.value}${item.unit ? ` ${item.unit}` : ""}` : "No reading"}
            </span>
          ) : (
            <ReadingInput
              value={item.value}
              unit={item.unit}
              disabled={locked}
              label={`${item.label} reading`}
              onCommit={(v) => onPatch({ value: v })}
            />
          ))}
          {showTechnician && (readOnly ? (
            <span className="text-xs text-gray-400">{item.technicianName ? `By ${item.technicianName}` : "No technician named"}</span>
          ) : (
            <input
              type="text"
              value={item.technicianName ?? ""}
              onChange={(e) => onPatch({ technicianName: e.target.value.slice(0, MAX_TECHNICIAN_NAME) })}
              disabled={locked}
              placeholder="Technician"
              aria-label={`${item.label} technician`}
              className="w-40 bg-white/5 border border-white/10 text-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-orange-500 disabled:opacity-50"
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ResultChip({ status }: { status: ChecklistResult | null }) {
  if (!status) return <span className="text-xs text-gray-600">Not rated</span>;
  const { icon: Icon, on } = RESULT_STYLE[status];
  return (
    <span className={`text-xs px-2 py-1 rounded-lg border flex items-center gap-1 ${on}`}>
      <Icon className="w-3.5 h-3.5" /> {CHECKLIST_RESULT_LABELS[status]}
    </span>
  );
}

/** Keeps what is being typed ("13." mid-entry) apart from the stored number. */
function ReadingInput({ value, unit, disabled, label, onCommit }: {
  value: number | null; unit?: string; disabled: boolean; label: string;
  onCommit: (v: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid}
        placeholder="Reading"
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const parsed = parseReading(raw);
          setInvalid(parsed === undefined);
          if (parsed !== undefined) onCommit(parsed);
        }}
        className={`w-24 bg-white/5 border text-white rounded-lg px-2.5 py-1.5 text-xs tabular-nums focus:outline-none disabled:opacity-50 ${
          invalid ? "border-red-500/60 focus:border-red-500" : "border-white/10 focus:border-orange-500"
        }`}
      />
      {unit && <span className="text-xs text-gray-500">{unit}</span>}
    </div>
  );
}
