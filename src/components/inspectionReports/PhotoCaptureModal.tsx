import { useEffect, useState } from "react";
import { Loader2, RotateCw, X } from "lucide-react";
import { processPhoto } from "../../lib/inspectionReports/media";

/**
 * Preview of one photo after the EXIF fix and resize, with a manual 90° rotate
 * before it is saved. The preview is always rendered from the ORIGINAL file, so
 * rotating twice never re-compresses an already-compressed image.
 */
export default function PhotoCaptureModal({
  file, remaining, onConfirm, onSkip,
}: {
  file: File;
  /** Photos still waiting after this one. */
  remaining: number;
  onConfirm: (processed: Blob) => void | Promise<void>;
  onSkip: () => void;
}) {
  const [turns, setTurns] = useState(0);
  // The latest finished render, tagged with the rotation it was made for, so a
  // stale one is never shown while a new rotation is still being processed.
  const [done, setDone] = useState<{ turns: number; blob: Blob; url: string } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const ready = done && done.turns === turns ? done : null;

  // The parent keys this modal by file, so it starts fresh for every photo.
  useEffect(() => {
    let active = true;
    let made: string | null = null;
    processPhoto(file, turns)
      .then((blob) => {
        if (!active) return;
        made = URL.createObjectURL(blob);
        setDone({ turns, blob, url: made });
      })
      .catch(() => { if (active) setError("This photo couldn't be read. Try a different one."); });
    return () => { active = false; if (made) URL.revokeObjectURL(made); };
  }, [file, turns]);

  async function confirm() {
    if (!ready || saving) return;
    setSaving(true);
    try { await onConfirm(ready.blob); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center">
      <div className="bg-[#0B1120] border border-white/10 sm:rounded-xl rounded-t-2xl w-full sm:max-w-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">
            Add photo{remaining > 0 && <span className="text-gray-500 font-normal"> · {remaining} more</span>}
          </h2>
          <button type="button" onClick={onSkip} aria-label="Discard photo" className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="aspect-[4/3] w-full rounded-lg bg-[#162032] flex items-center justify-center overflow-hidden">
          {error ? <p className="text-xs text-red-300 px-4 text-center">{error}</p>
            : ready ? <img src={ready.url} alt="Preview" className="max-h-full max-w-full object-contain" />
            : <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTurns((t) => t + 1)}
            disabled={!ready}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-300 hover:text-white disabled:opacity-40"
          >
            <RotateCw className="w-3.5 h-3.5" /> Rotate
          </button>
          <div className="flex-1" />
          <button type="button" onClick={onSkip} className="px-3 py-2 text-xs text-gray-400 hover:text-white">
            Discard
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!ready || saving}
            className="rounded-lg bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-40 px-4 py-2 text-xs font-semibold text-white"
          >
            {saving ? "Saving…" : "Use photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
