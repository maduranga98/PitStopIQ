import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { DiagnosticReport } from "../../types/diagnosticReports";
import DiagnosticReportItem from "./DiagnosticReportItem";
import DiagnosticReportViewer from "./DiagnosticReportViewer";
import DiagnosticReportUploadSheet from "./DiagnosticReportUploadSheet";

interface DiagnosticReportListProps {
  centerId: string;
  centerName: string;
  vehicleId: string;
  customerId: string;
  plateNumber: string;
  /** null = standalone uploads (vehicle Reports tab / dashboard tile). */
  serviceId: string | null;
  jobStatus?: string;
  uploadedBy: string;
  uploadedByName: string;
  canManage: boolean;
  reports: DiagnosticReport[];
  loading: boolean;
  onReportsChanged: (reports: DiagnosticReport[]) => void;
  emptyLabel?: string;
}

/** The shared list + upload entry point used on the job card, the vehicle
 *  Reports tab, and the dashboard's "Upload Scan Report" tile. */
export default function DiagnosticReportList({
  centerId, centerName, vehicleId, customerId, plateNumber, serviceId, jobStatus,
  uploadedBy, uploadedByName, canManage, reports, loading, onReportsChanged, emptyLabel,
}: DiagnosticReportListProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewing, setViewing] = useState<DiagnosticReport | null>(null);

  // Keep the viewer in sync if the underlying report changes (e.g. its
  // upload finishes while the sheet is open).
  useEffect(() => {
    if (!viewing) return;
    const fresh = reports.find((r) => r.id === viewing.id);
    if (fresh && fresh !== viewing) setViewing(fresh);
  }, [reports, viewing]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
          Diagnostic Reports
        </div>
        <button
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"
        >
          <Plus className="w-3.5 h-3.5" /> Upload Report
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : reports.length === 0 ? (
        <p className="text-xs text-gray-500">{emptyLabel ?? "No scan reports yet."}</p>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <DiagnosticReportItem
              key={r.id}
              report={r}
              centerName={centerName}
              plateNumber={plateNumber}
              canManage={canManage}
              onView={setViewing}
              onChanged={(updated) => onReportsChanged(reports.map((x) => (x.id === updated.id ? updated : x)))}
              onDeleted={(id) => onReportsChanged(reports.filter((x) => x.id !== id))}
            />
          ))}
        </div>
      )}

      <DiagnosticReportUploadSheet
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onCreated={(report) => onReportsChanged([report, ...reports])}
        centerId={centerId}
        vehicleId={vehicleId}
        customerId={customerId}
        serviceId={serviceId}
        jobStatus={jobStatus}
        uploadedBy={uploadedBy}
        uploadedByName={uploadedByName}
      />

      {viewing && <DiagnosticReportViewer report={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
