import { X, Download } from "lucide-react";
import type { DiagnosticReport } from "../../types/diagnosticReports";

interface DiagnosticReportViewerProps {
  report: DiagnosticReport;
  onClose: () => void;
}

/** In-app viewer sheet: PDF via an iframe embed with a Download fallback,
 *  images in a zoomable lightbox (native pinch-zoom on a full-bleed <img>). */
export default function DiagnosticReportViewer({ report, onClose }: DiagnosticReportViewerProps) {
  const url = report.fileUrl;

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#0B1120]">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{report.title}</p>
          <p className="text-xs text-gray-500 truncate">{report.fileName}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {url && (
            <a
              href={url}
              download={report.fileName}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white bg-white/5 border border-white/10 rounded-lg px-3 py-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
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
