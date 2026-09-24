import { useEffect } from "react";
import { ArrowLeft, Download } from "lucide-react";
import type { DiagnosticReport } from "../../types/diagnosticReports";

interface DiagnosticReportViewerProps {
  report: DiagnosticReport;
  onClose: () => void;
}

/** In-app viewer sheet: PDF via an iframe embed with a Download fallback,
 *  images in a zoomable lightbox (native pinch-zoom on a full-bleed <img>). */
export default function DiagnosticReportViewer({ report, onClose }: DiagnosticReportViewerProps) {
  const url = report.fileUrl;

  // Opening this doesn't navigate anywhere, so without a history entry of
  // its own, a phone's hardware/gesture back button has nothing to "close"
  // here — it falls through to whatever the browser would otherwise do,
  // which can mean leaving the job card entirely rather than just
  // dismissing the report. Pushing a state on open and treating popstate as
  // a close request makes back behave the way it looks like it should.
  useEffect(() => {
    try {
      history.pushState({ diagnosticReportViewer: true }, "");
    } catch {
      // Some embedded/locked-down webviews restrict the History API. Losing
      // the back-button integration there is a smaller problem than
      // crashing the viewer over it — the on-screen Back button still works.
    }
    const onPopState = () => onClose();
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onKeyDown);
      // If we're closing for a reason other than back navigation (the Back
      // button, Escape), the state we pushed is still sitting there — pop
      // it so a later back press doesn't fire a second, ghost "close" on
      // whatever screen the user goes to next.
      try {
        if (history.state?.diagnosticReportViewer) history.back();
      } catch {
        // As above — non-fatal.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
      <div className="flex items-center justify-between gap-3 px-3 py-3 border-b border-white/10 bg-[#0B1120]">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-white hover:text-gray-300 flex-shrink-0 -ml-1 px-2 py-1.5 rounded-lg hover:bg-white/5"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>
        <div className="min-w-0 flex-1 text-right sm:text-left">
          <p className="text-sm font-medium text-white truncate">{report.title}</p>
          <p className="text-xs text-gray-500 truncate">{report.fileName}</p>
        </div>
        {url && (
          <a
            href={url}
            download={report.fileName}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 flex-shrink-0"
          >
            <Download className="w-3.5 h-3.5" /> Download
          </a>
        )}
      </div>

      <div className="flex-1 overflow-auto flex items-center justify-center p-2">
        {!url ? (
          <p className="text-sm text-gray-400">This report hasn't finished uploading yet.</p>
        ) : report.fileType === "pdf" ? (
          <iframe title={report.title} src={url} className="w-full h-full bg-white rounded-lg" />
        ) : (
          <img
            src={url}
            alt={report.title}
            className="max-w-full max-h-full object-contain touch-pinch-zoom"
          />
        )}
      </div>
    </div>
  );
}
