import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { AlertCircle, Download, MessageCircle, Phone } from "lucide-react";
import { functions } from "../../config/firebase";
import { LoadingScreen } from "../../components/LoadingProgress";
import { REPORT_TYPE_LABEL } from "../../lib/diagnosticReports";
import type { DiagnosticReportType, DiagnosticReportFileType } from "../../types/diagnosticReports";

// The public page never touches Firestore directly — see
// storage.rules/firestore.rules: no rule grants an unauthenticated client
// read access to a diagnostic report, on purpose. getPublicReport (Admin SDK,
// bypasses rules) is the only path that can tell "no such token" apart from
// "that report exists but was made private", which the two branded states
// below need to show the right one.
interface PublicReportPayload {
  found: boolean;
  isPublic?: boolean;
  report?: {
    title: string;
    reportNumber: string;
    reportType: DiagnosticReportType;
    scanTool: string | null;
    fileUrl: string | null;
    fileType: DiagnosticReportFileType;
    fileName: string;
    uploadedByName: string;
    createdAtMillis: number | null;
  };
  vehicle?: { plateNumber: string; make?: string; model?: string };
  center?: { name: string; logoUrl?: string; phone?: string };
}

function formatDate(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function BrandedShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0B1120] text-white flex flex-col items-center justify-center gap-3 p-6">
      {children}
    </div>
  );
}

export default function DiagnosticReportPublicView() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [payload, setPayload] = useState<PublicReportPayload | null>(null);
  const trackedRef = useRef(false);

  useEffect(() => {
    if (!shareToken) return;
    let active = true;
    setLoading(true);
    setLoadError(false);
    const fn = httpsCallable<{ shareToken: string }, PublicReportPayload>(functions, "getPublicReport");
    fn({ shareToken })
      .then((res) => { if (active) setPayload(res.data); })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [shareToken]);

  // Counted once per page load, and only for a report that actually renders.
  useEffect(() => {
    if (!shareToken || trackedRef.current || !payload?.found || !payload.isPublic) return;
    trackedRef.current = true;
    httpsCallable(functions, "trackReportView")({ shareToken }).catch(() => {});
  }, [shareToken, payload]);

  if (loading) return <LoadingScreen />;

  if (loadError) {
    return (
      <BrandedShell>
        <AlertCircle className="w-10 h-10 text-gray-500" />
        <p className="text-gray-400 text-center">Couldn't load this report. Check your connection and try again.</p>
      </BrandedShell>
    );
  }

  if (!payload?.found) {
    return (
      <BrandedShell>
        <AlertCircle className="w-10 h-10 text-gray-500" />
        <p className="text-gray-300 font-medium">Report not found</p>
        <p className="text-gray-500 text-sm text-center">This link doesn't match any report.</p>
      </BrandedShell>
    );
  }

  if (!payload.isPublic) {
    return (
      <BrandedShell>
        <AlertCircle className="w-10 h-10 text-gray-500" />
        <p className="text-gray-300 font-medium">This report is no longer available</p>
        <p className="text-gray-500 text-sm text-center">Contact the service center for a fresh copy.</p>
      </BrandedShell>
    );
  }

  const { report, vehicle, center } = payload;
  if (!report || !vehicle || !center) return null;

  return (
    <div className="min-h-screen bg-[#0B1120] text-white pb-16">
      <div className="border-b border-white/10 bg-[#162032]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-4">
          {center.logoUrl
            ? <img src={center.logoUrl} alt="" className="w-10 h-10 rounded-lg object-contain bg-white/5" />
            : <div className="w-10 h-10 rounded-lg bg-[#F97316]/20 flex items-center justify-center text-[#F97316] font-bold">
                {center.name.charAt(0)}
              </div>}
          <div>
            <p className="text-xs text-gray-400">{center.name}</p>
            <h1 className="text-lg font-bold">Diagnostic Report</h1>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="font-mono font-bold text-lg">{vehicle.plateNumber}</p>
              <p className="text-xs text-gray-400">
                {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"}
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-[#F97316]/10 text-[#F97316] border border-[#F97316]/20">
              {REPORT_TYPE_LABEL[report.reportType]}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4 text-xs text-gray-400">
            <div>Report: <span className="text-white">{report.reportNumber}</span></div>
            <div>Date: <span className="text-white">{formatDate(report.createdAtMillis)}</span></div>
            {report.scanTool && <div>Scan Tool: <span className="text-white">{report.scanTool}</span></div>}
            <div>Technician: <span className="text-white">{report.uploadedByName}</span></div>
          </div>
        </div>

        <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">{report.title}</h2>
            {report.fileUrl && (
              <a
                href={report.fileUrl}
                download={report.fileName}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 bg-[#F97316]/10 hover:bg-[#F97316]/20 border border-[#F97316]/20 text-[#F97316] text-xs px-3 py-2 rounded-lg transition"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </a>
            )}
          </div>
          {report.fileUrl ? (
            report.fileType === "pdf" ? (
              <iframe title={report.title} src={report.fileUrl} className="w-full h-[70vh] bg-white rounded-lg" />
            ) : (
              <img src={report.fileUrl} alt={report.title} className="w-full rounded-lg" />
            )
          ) : (
            <p className="text-sm text-gray-500">This report hasn't finished uploading yet — check back shortly.</p>
          )}
        </div>

        {center.phone && (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-3">
            <a href={`tel:${center.phone}`} className="flex items-center gap-2 text-sm text-gray-300 hover:text-white">
              <Phone className="w-4 h-4" /> {center.phone}
            </a>
            <a
              href={`https://wa.me/${center.phone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded-lg transition"
            >
              <MessageCircle className="w-4 h-4" /> WhatsApp Us
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
