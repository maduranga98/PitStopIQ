import { useEffect, useRef, useState } from "react";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../../config/firebase";
import { useNetworkStore } from "../../store/networkSlice";
import { usePhotoUploadQueue } from "../../hooks/usePhotoUploadQueue";
import { compressImage, blobToBase64 } from "../../lib/imageCompressor";
import {
  createDiagnosticReport, defaultReportTitle, defaultReportType, fetchScanToolSuggestions,
  fileTypeFor, lastUsedScanTool, reportStoragePath, reportsCollection,
} from "../../lib/diagnosticReports";
import { doc } from "firebase/firestore";
import type { DiagnosticReport, DiagnosticReportType } from "../../types/diagnosticReports";
import { FileText, Image as ImageIcon, Upload, X, ChevronDown, AlertCircle } from "lucide-react";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png"];

const TYPE_OPTIONS: { id: DiagnosticReportType; label: string }[] = [
  { id: "pre", label: "Pre-Repair" },
  { id: "post", label: "Post-Repair" },
  { id: "standalone", label: "Standalone" },
];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionFor(file: File): string {
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/png") return "png";
  return "jpg";
}

interface DiagnosticReportUploadSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated: (report: DiagnosticReport) => void;
  centerId: string;
  vehicleId: string;
  customerId: string;
  /** null = standalone (vehicle Reports tab / dashboard tile). */
  serviceId: string | null;
  /** Used only to pick the default report type. */
  jobStatus?: string;
  uploadedBy: string;
  uploadedByName: string;
}

export default function DiagnosticReportUploadSheet({
  open, onClose, onCreated, centerId, vehicleId, customerId, serviceId, jobStatus,
  uploadedBy, uploadedByName,
}: DiagnosticReportUploadSheetProps) {
  const status = useNetworkStore((s) => s.status);
  const { enqueuePhoto } = usePhotoUploadQueue();

  const initialType = defaultReportType(jobStatus);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [reportType, setReportType] = useState<DiagnosticReportType>(initialType);
  const [title, setTitle] = useState(defaultReportTitle(initialType));
  const [titleTouched, setTitleTouched] = useState(false);
  const [scanTool, setScanTool] = useState("");
  const [scanToolSuggestions, setScanToolSuggestions] = useState<string[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Reset on every open so a previous upload's state never leaks into the
    // next one.
    setFile(null);
    setFileError("");
    setReportType(initialType);
    setTitle(defaultReportTitle(initialType));
    setTitleTouched(false);
    setNotesOpen(false);
    setNotes("");
    setSubmitError("");
    const remembered = lastUsedScanTool(centerId);
    setScanTool(remembered ?? "");
    fetchScanToolSuggestions(centerId).then(setScanToolSuggestions).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, centerId]);

  if (!open) return null;

  function pickType(type: DiagnosticReportType) {
    setReportType(type);
    if (!titleTouched) setTitle(defaultReportTitle(type));
  }

  function handleFile(f: File) {
    setFileError("");
    if (!ACCEPTED_MIME.includes(f.type)) {
      setFileError("Only PDF, JPG or PNG files are accepted.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError("File is too large — the limit is 10 MB.");
      return;
    }
    setFile(f);
  }

  async function handleSubmit() {
    if (!file || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const fileType = fileTypeFor(file.type);
      const online = status !== "offline" && navigator.onLine;

      if (online) {
        // Upload first so the document is created with its final URL in one
        // write — a job card that never sees uploadPending for the common
        // case of a connected upload.
        const reportRef = doc(reportsCollection(centerId));
        const path = reportStoragePath(centerId, vehicleId, reportRef.id, extensionFor(file));
        const toUpload = fileType === "image" ? await compressImage(file) : file;
        await uploadBytes(storageRef(storage, path), toUpload, { contentType: file.type });
        const fileUrl = await getDownloadURL(storageRef(storage, path));
        const report = await createDiagnosticReport({
          centerId, serviceId, vehicleId, customerId, reportType, title, scanTool: scanTool || null,
          notes: notesOpen ? notes : null,
          fileName: file.name, fileType, fileSizeBytes: file.size, fileUrl, uploadPending: false,
          uploadedBy, uploadedByName,
        });
        onCreated(report);
      } else {
        // Offline: the document is created right away (fileUrl: null,
        // uploadPending: true) so it shows up on the job card immediately,
        // and the actual bytes go through the same IndexedDB queue the
        // inspection photos use, retried on reconnect.
        const report = await createDiagnosticReport({
          centerId, serviceId, vehicleId, customerId, reportType, title, scanTool: scanTool || null,
          notes: notesOpen ? notes : null,
          fileName: file.name, fileType, fileSizeBytes: file.size, fileUrl: null, uploadPending: true,
          uploadedBy, uploadedByName,
        });
        const path = reportStoragePath(centerId, vehicleId, report.id, extensionFor(file));
        const base64 = await blobToBase64(file);
        await enqueuePhoto({
          storagePath: path,
          base64Data: base64,
          mimeType: file.type,
          fileType,
          metadata: {
            centerId, serviceId: report.id, type: "diagnosticReport",
            fieldPath: `servicecenters/${centerId}/diagnosticReports/${report.id}`,
            fieldKey: "fileUrl",
          },
          createdAt: Date.now(),
        });
        onCreated(report);
      }
      onClose();
    } catch {
      setSubmitError("Couldn't save this report. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50">
      <div className="bg-[#0B1120] border border-white/10 sm:rounded-xl rounded-t-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 sticky top-0 bg-[#0B1120]">
          <h2 className="text-base font-semibold text-white">Upload Scan Report</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* 1. File */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
              File
            </label>
            {file ? (
              <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
                {file.type === "application/pdf"
                  ? <FileText className="w-5 h-5 text-[#F97316] flex-shrink-0" />
                  : <ImageIcon className="w-5 h-5 text-[#F97316] flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
                </div>
                <button onClick={() => setFile(null)} className="text-gray-400 hover:text-white flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 border-2 border-dashed border-white/15 rounded-lg py-8 text-gray-400 hover:border-[#F97316]/50 hover:text-gray-300 transition"
              >
                <Upload className="w-6 h-6" />
                <span className="text-sm">Tap to choose a PDF or photo</span>
                <span className="text-xs text-gray-500">PDF, JPG or PNG · up to 10 MB</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              capture="environment"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
              className="hidden"
            />
            {fileError && (
              <p className="flex items-center gap-1.5 text-xs text-red-400 mt-2">
                <AlertCircle className="w-3.5 h-3.5" /> {fileError}
              </p>
            )}
          </div>

          {/* 2. Report type */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
              Report Type
            </label>
            <div className="grid grid-cols-3 gap-1.5 bg-white/5 border border-white/10 rounded-lg p-1">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => pickType(opt.id)}
                  className={`text-xs font-medium py-2 rounded-md transition ${
                    reportType === opt.id
                      ? "bg-[#F97316] text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Title */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }}
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* 4. Scan tool */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
              Scan Tool
            </label>
            <input
              type="text"
              list="scan-tool-suggestions"
              value={scanTool}
              onChange={(e) => setScanTool(e.target.value)}
              placeholder="e.g. Launch X-431"
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500"
            />
            <datalist id="scan-tool-suggestions">
              {scanToolSuggestions.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>

          {/* Notes (collapsed) */}
          <div>
            <button
              type="button"
              onClick={() => setNotesOpen((v) => !v)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${notesOpen ? "rotate-180" : ""}`} />
              Notes (optional)
            </button>
            {notesOpen && (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Anything worth noting about this scan…"
                className="w-full mt-2 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 resize-none"
              />
            )}
          </div>

          {submitError && (
            <p className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5" /> {submitError}
            </p>
          )}

          {status === "offline" && (
            <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              You're offline — this will upload automatically once you're back online.
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={!file || submitting}
            className="w-full bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg text-sm transition"
          >
            {submitting ? "Saving…" : "Upload Report"}
          </button>
        </div>
      </div>
    </div>
  );
}
