// The post-service checklist as it reads back on a job once it has been signed
// off — the results, who signed it, and when. Read-only: a completed checklist
// is frozen by the security rules.
import { ClipboardCheck } from "lucide-react";
import type { PostServiceChecklist, StaffMember } from "../../types/auth";
import { CHECKLIST_RESULT_LABELS } from "../../types/auth";
import { filledSectionsOf, resultCounts } from "../../lib/checklistFill";
import ChecklistFillForm from "./ChecklistFillForm";
import ChecklistPdfButton from "./ChecklistPdfButton";

export default function PostServiceChecklistCard({ checklist, staff, centerId, jobId }: {
  checklist: PostServiceChecklist;
  staff: StaffMember[];
  /** With the job id, offers the report PDF (a job's checklist is addressed by its job). */
  centerId?: string;
  jobId?: string;
}) {
  const by = staff.find((s) => s.id === checklist.completedBy);
  const name = by?.fullName || by?.displayName || null;
  const at = checklist.completedAt?.toDate?.();
  const sections = filledSectionsOf(checklist);
  const counts = resultCounts(sections);

  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-gray-300">
          <ClipboardCheck className="w-4 h-4 text-[#F97316]" />
          <span className="text-xs uppercase tracking-wider font-semibold">Post-Service Check</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {centerId && jobId && <ChecklistPdfButton centerId={centerId} kind="job" id={jobId} />}
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30">
            Signed off
          </span>
        </div>
      </div>

      <p className="text-xs text-gray-500 mb-3">
        {checklist.templateName}
        {name ? <> · signed off by <span className="text-gray-300">{name}</span></> : null}
        {at ? ` · ${at.toLocaleDateString()} ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : null}
      </p>

      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <span className="px-2 py-1 rounded-lg bg-green-500/10 text-green-300">{counts.ok} {CHECKLIST_RESULT_LABELS.ok.toLowerCase()}</span>
        {counts.attention > 0 && (
          <span className="px-2 py-1 rounded-lg bg-yellow-500/10 text-yellow-300">{counts.attention} {CHECKLIST_RESULT_LABELS.attention.toLowerCase()}</span>
        )}
        {counts.immediate > 0 && (
          <span className="px-2 py-1 rounded-lg bg-red-500/10 text-red-300">{counts.immediate} {CHECKLIST_RESULT_LABELS.immediate.toLowerCase()}</span>
        )}
      </div>

      <details className="group">
        <summary className="cursor-pointer text-xs text-orange-400 hover:text-orange-300 select-none list-none">
          <span className="group-open:hidden">Show the full report</span>
          <span className="hidden group-open:inline">Hide the full report</span>
        </summary>
        <div className="mt-4">
          <ChecklistFillForm sections={sections} remarks={checklist.remarks ?? ""} readOnly />
        </div>
      </details>
    </div>
  );
}
