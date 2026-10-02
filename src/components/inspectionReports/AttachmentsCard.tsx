import { useRef } from "react";
import { Paperclip, Plus } from "lucide-react";
import MediaThumb from "./MediaThumb";
import { MAX_ATTACHMENTS_PER_REPORT } from "../../constants/inspectionReports";
import type { InspectionMediaItem } from "../../types/inspectionReports";

/** Report-level attachments: PDF, JPG or PNG, up to the report's limit. */
export default function AttachmentsCard({
  attachmentIds, media, previews, readOnly, error, onAdd, onRemove,
}: {
  attachmentIds: string[];
  media: Record<string, InspectionMediaItem>;
  previews: Record<string, string>;
  readOnly: boolean;
  error: string;
  onAdd: (files: File[]) => void;
  onRemove: (mediaId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const full = attachmentIds.length >= MAX_ATTACHMENTS_PER_REPORT;
  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Paperclip className="w-4 h-4 text-[#F97316]" />
        <h2 className="text-sm font-semibold text-gray-100 flex-1">Attachments</h2>
        <span className="text-[11px] text-gray-500">{attachmentIds.length}/{MAX_ATTACHMENTS_PER_REPORT}</span>
      </div>
      {attachmentIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachmentIds.map((id) => media[id] && (
            <MediaThumb key={id} item={media[id]} preview={previews[id]} size="h-20 w-20" disabled={readOnly} onRemove={() => onRemove(id)} />
          ))}
        </div>
      )}
      {!readOnly && (
        <>
          <button
            type="button"
            disabled={full}
            onClick={() => input.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-gray-300 hover:text-white hover:border-white/40 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" /> Add PDF, JPG or PNG
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
