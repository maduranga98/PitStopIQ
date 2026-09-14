// The post-service checklist as it reads back on a job once it has been signed
// off — what was checked, by whom, and when. Read-only: a completed checklist
// is frozen by the security rules, and re-opening one would let the delivery
// gate be re-passed after the fact.
import { Check, ClipboardCheck } from "lucide-react";
import type { PostServiceChecklist, StaffMember } from "../../types/auth";

export default function PostServiceChecklistCard({ checklist, staff }: {
  checklist: PostServiceChecklist;
  staff: StaffMember[];
}) {
  const by = staff.find((s) => s.id === checklist.completedBy);
  const name = by?.fullName || by?.displayName || null;
  const at = checklist.completedAt?.toDate?.();

  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-gray-300">
          <ClipboardCheck className="w-4 h-4 text-[#F97316]" />
          <span className="text-xs uppercase tracking-wider font-semibold">Post-Service Check</span>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30 flex-shrink-0">
          Passed
        </span>
      </div>

      <p className="text-xs text-gray-500 mb-3">
        {checklist.templateName}
        {name ? <> · signed off by <span className="text-gray-300">{name}</span></> : null}
        {at ? ` · ${at.toLocaleDateString()} ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : null}
      </p>

      <div className="space-y-1.5">
        {checklist.items.map((item) => (
          <div key={item.id} className="flex items-center gap-2.5">
            <span className="w-4 h-4 rounded bg-green-500/20 border border-green-500/30 flex items-center justify-center flex-shrink-0">
              <Check className="w-2.5 h-2.5 text-green-400" />
            </span>
            <span className="text-sm text-gray-300 min-w-0">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
