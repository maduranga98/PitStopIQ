import { useRef, useState } from "react";
import { Loader2, Paperclip, Plus } from "lucide-react";
import MediaThumb from "./MediaThumb";
import { MAX_ATTACHMENTS_PER_REPORT } from "../../constants/inspectionReports";
import type { InspectionMediaItem } from "../../types/inspectionReports";

/** Report-level attachments: PDF, JPG or PNG, up to the report's limit. */
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function AttachmentsCard({
  attachmentIds, media, previews, readOnly, error, busy, diagnostic, onAdd, onRemove,
}: {
  attachmentIds: string[];
  media: Record<string, InspectionMediaItem>;
  previews: Record<string, string>;
  readOnly: boolean;
  error: string;
  /** Files are being processed / uploaded right now. */
  busy?: boolean;
  /** Diagnostic reports lead with their scan files. */
  diagnostic?: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (mediaId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const full = attachmentIds.length >= MAX_ATTACHMENTS_PER_REPORT;
  return (
    <div
      className={`bg-[#162032] border rounded-xl p-4 space-y-3 transition-colors ${dragging ? "border-[#F97316]/60" : "border-white/10"}`}
      onDragOver={readOnly ? undefined : (e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={readOnly ? undefined : (e) => {
        e.preventDefault(); setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onAdd(files);
      }}
    >
      <div className="flex items-center gap-2">
        <Paperclip className="w-4 h-4 text-[#F97316]" />
        <h2 className="text-sm font-semibold text-gray-100 flex-1">{diagnostic ? "Scan files and photos" : "Attachments"}</h2>
        <span className="text-[11px] text-gray-500">{attachmentIds.length}/{MAX_ATTACHMENTS_PER_REPORT}</span>
      </div>
      {attachmentIds.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {attachmentIds.map((id) => media[id] && (
            <div key={id} className="w-20">
              <MediaThumb item={media[id]} preview={previews[id]} size="h-20 w-20" disabled={readOnly} onRemove={() => onRemove(id)} />
              <p className="mt-1 text-[10px] text-gray-400 truncate" title={media[id].name}>{media[id].name}</p>
              <p className="text-[10px] text-gray-600">{media[id].mimeType === "application/pdf" ? "PDF" : "Image"} · {fmtSize(media[id].sizeBytes)}</p>
            </div>
          ))}
        </div>
      )}
      {busy && <p className="flex items-center gap-1.5 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding files…</p>}
      {!readOnly && (
        <>
          <button
            type="button"
            disabled={full || busy}
            onClick={() => input.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-gray-300 hover:text-white hover:border-white/40 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" /> Add PDF, JPG or PNG{diagnostic ? " (or drop files here)" : ""}
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) onAdd(files);
            }}
          />
        </>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
      <p className="text-[11px] text-gray-600">Up to 10 MB each. Images are kept for 12 months after the report is finalized.</p>
    </div>
  );
}
