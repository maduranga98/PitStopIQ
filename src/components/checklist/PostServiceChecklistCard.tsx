// The post-service checklist as it reads back on a job once it has been signed
// off — the results, who signed it, and when. Read-only: a completed checklist
// is frozen by the security rules.
import { ClipboardCheck } from "lucide-react";
import type { PostServiceChecklist, StaffMember } from "../../types/auth";
import { filledSectionsOf } from "../../lib/checklistFill";
import ChecklistFillForm from "./ChecklistFillForm";
import ChecklistPdfButton from "./ChecklistPdfButton";
import ChecklistSendButton from "./ChecklistSendButton";
import ChecklistSummary from "./ChecklistSummary";

export default function PostServiceChecklistCard({ checklist, staff, centerId, jobId, customer }: {
  checklist: PostServiceChecklist;
  staff: StaffMember[];
  /** With the job id, offers the report PDF (a job's checklist is addressed by its job). */
  centerId?: string;
  jobId?: string;
  /** Who and what the report is about, for the "Send to customer" message. */
  customer?: { name?: string; phone?: string; plate?: string };
}) {
  const by = staff.find((s) => s.id === checklist.completedBy);
  const name = by?.fullName || by?.displayName || null;
  const at = checklist.completedAt?.toDate?.();
  const sections = filledSectionsOf(checklist);

  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-gray-300">
          <ClipboardCheck className="w-4 h-4 text-[#F97316]" />
          <span className="text-xs uppercase tracking-wider font-semibold">Post-Service Check</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {centerId && jobId && <ChecklistPdfButton centerId={centerId} kind="job" id={jobId} />}
          {centerId && jobId && (
            <ChecklistSendButton
              centerId={centerId} kind="job" id={jobId}
              customerName={customer?.name} customerPhone={customer?.phone} plate={customer?.plate}
            />
          )}
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

      <div className="mb-3"><ChecklistSummary sections={sections} /></div>

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
