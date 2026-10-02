import type { InspectionReportStatus, InspectionReportType } from "../../types/inspectionReports";

export function TypeBadge({ type }: { type: InspectionReportType }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-px border border-white/10 text-gray-400">
      {type === "diagnostic" ? "Diagnostic" : "Checklist"}
    </span>
  );
}

export function StatusBadge({ status }: { status: InspectionReportStatus }) {
  return status === "finalized" ? (
    <span className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-px bg-green-500/10 text-green-400 border border-green-500/25">Final</span>
  ) : (
    <span className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-px bg-amber-500/10 text-amber-400 border border-amber-500/25">Draft</span>
  );
}
