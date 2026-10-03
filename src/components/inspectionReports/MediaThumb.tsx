import { FileText, Loader2, X, ImageOff } from "lucide-react";
import type { InspectionMediaItem } from "../../types/inspectionReports";

/** A photo or attachment tile: the image, a local preview while it's still
 *  queued, "Photo expired" once retention has passed, and a remove button. */
export default function MediaThumb({
  item, preview, onRemove, disabled, size = "h-16 w-16",
}: {
  item: InspectionMediaItem;
  /** Object URL of the bytes this device just captured (survives until reload). */
  preview?: string;
  onRemove?: () => void;
  disabled?: boolean;
  size?: string;
}) {
  const src = item.url ?? preview ?? null;
  const isPdf = item.mimeType === "application/pdf";
  const body = item.mediaDeleted ? (
    <span className="flex flex-col items-center gap-0.5 text-[9px] text-gray-500 text-center leading-tight px-1">
      <ImageOff className="w-4 h-4" /> Photo expired
    </span>
  ) : isPdf ? (
    <span className="flex flex-col items-center gap-0.5 text-[9px] text-gray-400 text-center leading-tight px-1">
      <FileText className="w-5 h-5 text-[#F97316]" />
      <span className="line-clamp-2 break-all">{item.name}</span>
    </span>
  ) : src ? (
    <img src={src} alt={item.name} className="h-full w-full object-cover" />
  ) : (
    <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
  );

  const inner = (
    <div className={`${size} rounded-lg overflow-hidden bg-[#0B1120] border border-white/10 flex items-center justify-center`}>
      {body}
    </div>
  );

  return (
    <div className="relative flex-shrink-0">
      {item.url && !item.mediaDeleted ? (
        <a href={item.url} target="_blank" rel="noreferrer">{inner}</a>
      ) : inner}
      {item.pending && !item.mediaDeleted && (
        <span className="absolute bottom-0.5 left-0.5 rounded bg-amber-500/90 px-1 text-[8px] font-semibold text-black">
          Queued
        </span>
      )}
      {onRemove && !disabled && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-[#0B1120] border border-white/20 text-gray-300 hover:text-white flex items-center justify-center"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
