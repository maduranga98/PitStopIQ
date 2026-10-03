import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, Download } from "lucide-react";
import { LoadingScreen } from "../../components/LoadingProgress";
import PublicReportView from "../../components/inspectionReports/PublicReportView";
import { fetchPublicReport, trackPublicReportView } from "../../lib/inspectionReports/share";
import type { PublicInspectionPayload } from "../../types/inspectionReports";

function Shell({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0B1120] text-white flex flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertCircle className="w-10 h-10 text-gray-500" />
      <p className="text-gray-200 font-medium">{title}</p>
      {body && <p className="text-gray-500 text-sm max-w-xs">{body}</p>}
      {children}
    </div>
  );
}

/**
 * /i/:shareToken — a report shared by link. Never reads Firestore or Storage
 * directly: getPublicInspectionReport (Admin SDK) is the only door, which is
 * what lets it tell "no such link" from "revoked".
 */
export default function InspectionReportPublicView() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [payload, setPayload] = useState<PublicInspectionPayload | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const tracked = useRef(false);

  useEffect(() => {
    if (!shareToken) return;
    let active = true;
    fetchPublicReport(shareToken)
      .then((p) => { if (active) { setPayload(p); setError(false); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [shareToken, attempt]);

  // Counted once per page load, and only for a report a customer can actually see.
  useEffect(() => {
    if (!shareToken || tracked.current || !payload?.found) return;
    if (payload.state !== "ready" && payload.state !== "updating") return;
    tracked.current = true;
    trackPublicReportView(shareToken);
  }, [shareToken, payload]);

  if (error) {
    return (
      <Shell title="Couldn't load this report" body="Check your connection and try again.">
        <button onClick={() => { setError(false); setAttempt((n) => n + 1); }} className="text-sm text-[#F97316]">Try again</button>
      </Shell>
    );
  }
  if (!payload) return <LoadingScreen />;
  if (!payload.found) return <Shell title="Report not found" body="This link doesn't match any report." />;
  if (payload.state === "revoked") return <Shell title="This report is no longer available" body={`Contact ${payload.center.name} for a fresh copy.`} />;
  if (payload.state === "notReady") return <Shell title="This report isn't ready yet" body="Please check back shortly." />;
  if (payload.state === "updating") {
    return (
      <Shell title={`${payload.reportNumber} is being updated`} body={`${payload.center.name} is making changes to this report. Check back soon.`}>
        {payload.pdfUrl && (
          <a href={payload.pdfUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-[#F97316]">
            <Download className="w-4 h-4" /> Download the last issued version
          </a>
        )}
      </Shell>
    );
  }
  return <PublicReportView report={payload.report} center={payload.center} />;
}
