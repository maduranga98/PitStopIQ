// The headline of a signed-off checklist: how many lines fell in each result,
// and — front and centre, red first — the lines that need doing something about.
import type { FilledChecklistSection } from "../../types/auth";
import { CHECKLIST_RESULT_LABELS } from "../../types/auth";
import { resultCounts } from "../../lib/checklistFill";
import { ResultChip } from "./ChecklistFillForm";

export default function ChecklistSummary({ sections }: { sections: FilledChecklistSection[] }) {
  const counts = resultCounts(sections);
  const flagged = sections
    .flatMap((s) => s.items.map((i) => ({ ...i, section: s.title })))
    .filter((i) => i.status === "attention" || i.status === "immediate")
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "immediate" ? -1 : 1));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs" aria-label="Results">
        <span className="px-2 py-1 rounded-lg bg-green-500/10 text-green-300">{counts.ok} {CHECKLIST_RESULT_LABELS.ok.toLowerCase()}</span>
        {counts.attention > 0 && (
          <span className="px-2 py-1 rounded-lg bg-yellow-500/10 text-yellow-300">{counts.attention} {CHECKLIST_RESULT_LABELS.attention.toLowerCase()}</span>
        )}
        {counts.immediate > 0 && (
          <span className="px-2 py-1 rounded-lg bg-red-500/10 text-red-300">{counts.immediate} {CHECKLIST_RESULT_LABELS.immediate.toLowerCase()}</span>
        )}
      </div>

      {flagged.length > 0 && (
        <div className="border border-white/10 rounded-xl divide-y divide-white/5">
          <p className="px-3 py-2 text-xs uppercase tracking-wider font-semibold text-gray-300">Needs attention</p>
          {flagged.map((i) => (
            <div key={`${i.section}-${i.id}`} className="px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm text-white">
                  {i.label}
                  {i.type === "status_numeric" && i.value !== null && (
                    <span className="text-gray-400 tabular-nums"> · {i.value}{i.unit ? ` ${i.unit}` : ""}</span>
                  )}
                </p>
                <p className="text-xs text-gray-500">{i.section}</p>
              </div>
              <ResultChip status={i.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
