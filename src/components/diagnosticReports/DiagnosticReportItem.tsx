import { useState } from "react";
import {
  FileText, Image as ImageIcon, MoreVertical, Share2, Eye, Download, Pencil, Trash2, EyeOff,
} from "lucide-react";
import type { DiagnosticReport } from "../../types/diagnosticReports";
import {
  REPORT_TYPE_LABEL, buildWhatsAppShareMessage, deleteReport, renameReport, setReportPublic,
  whatsAppShareLink,
} from "../../lib/diagnosticReports";

function formatDate(ts?: { toDate: () => Date } | null) {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DiagnosticReportItemProps {
  report: DiagnosticReport;
  centerName: string;
  plateNumber: string;
  canManage: boolean;
  onView: (report: DiagnosticReport) => void;
  onChanged: (report: DiagnosticReport) => void;
  onDeleted: (reportId: string) => void;
}

export default function DiagnosticReportItem({
  report, centerName, plateNumber, canManage, onView, onChanged, onDeleted,
}: DiagnosticReportItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(report.title);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleToggleShared() {
    setBusy(true);
    try {
      await setReportPublic(report.centerId, report.id, !report.isPublic);
      onChanged({ ...report, isPublic: !report.isPublic });
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  }

  async function handleRename() {
    if (!titleDraft.trim()) return;
    setBusy(true);
    try {
      await renameReport(report.centerId, report.id, titleDraft);
      onChanged({ ...report, title: titleDraft.trim() });
      setRenaming(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteReport(report);
      onDeleted(report.id);
    } finally {
      setBusy(false);
    }
  }

  const shareMessage = buildWhatsAppShareMessage({
    centerName, plateNumber, title: report.title, dateLabel: formatDate(report.createdAt), shareToken: report.shareToken,
  });

  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {report.thumbnailUrl ? (
            <img src={report.thumbnailUrl} alt="" className="w-full h-full object-cover" />
          ) : report.fileType === "pdf" ? (
            <FileText className="w-5 h-5 text-[#F97316]" />
          ) : (
            <ImageIcon className="w-5 h-5 text-[#F97316]" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
                className="flex-1 bg-white/5 border border-white/10 text-white rounded px-2 py-1 text-sm focus:outline-none focus:border-orange-500"
              />
              <button onClick={handleRename} disabled={busy} className="text-xs text-[#F97316]">Save</button>
              <button onClick={() => { setRenaming(false); setTitleDraft(report.title); }} className="text-xs text-gray-400">Cancel</button>
            </div>
          ) : (
            <p className="text-sm font-medium text-white truncate flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 sm:hidden" />
              {report.title}
              {!report.isPublic && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-400 flex-shrink-0">
                  Private
                </span>
              )}
            </p>
          )}
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {REPORT_TYPE_LABEL[report.reportType]}
            {report.scanTool ? ` · ${report.scanTool}` : ""} · {formatDate(report.createdAt)} · {formatSize(report.fileSizeBytes)}
          </p>
          {report.uploadPending && (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5 mt-1.5">
              🟡 Pending upload
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => onView(report)}
          disabled={report.uploadPending}
          className="flex items-center gap-1 text-xs text-gray-300 hover:text-white bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 disabled:opacity-40"
        >
          <Eye className="w-3.5 h-3.5" /> View
        </button>
        <a
          href={report.uploadPending || !report.isPublic ? undefined : whatsAppShareLink(shareMessage)}
          target="_blank"
          rel="noreferrer"
          aria-disabled={report.uploadPending || !report.isPublic}
          className={`flex items-center gap-1 text-xs rounded-lg px-2.5 py-1.5 border ${
            report.uploadPending || !report.isPublic
              ? "text-gray-600 border-white/5 pointer-events-none"
              : "text-gray-300 hover:text-white bg-white/5 border-white/10"
          }`}
        >
          <Share2 className="w-3.5 h-3.5" /> Share
        </a>

        {canManage && (
          <div className="relative ml-auto">
            <button onClick={() => setMenuOpen((v) => !v)} className="text-gray-400 hover:text-white p-1.5">
              <MoreVertical className="w-4 h-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-44 bg-[#162032] border border-white/10 rounded-lg shadow-xl z-20 py-1">
                  <button
                    onClick={() => { setRenaming(true); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-white/5"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Rename
                  </button>
                  <button
                    onClick={handleToggleShared}
                    disabled={busy}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-white/5"
                  >
                    {report.isPublic ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {report.isPublic ? "Make Private" : "Make Shared"}
                  </button>
                  {report.fileUrl && (
                    <a
                      href={report.fileUrl}
                      download={report.fileName}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-white/5"
                    >
                      <Download className="w-3.5 h-3.5" /> Download
                    </a>
                  )}
                  <button
                    onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#162032] border border-white/10 rounded-xl p-5 max-w-sm w-full space-y-3">
            <h3 className="font-semibold text-white text-sm">Delete this report?</h3>
            <p className="text-xs text-gray-400">
              "{report.title}" and its file will be permanently removed. This can't be undone, and the
              shared link will stop working.
            </p>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-400 hover:text-white px-3 py-1.5">
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={busy}
                className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
