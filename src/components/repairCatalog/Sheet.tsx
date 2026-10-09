import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * A modal that is a bottom sheet on phones and a centred card on larger
 * screens. Same dark card styling as the rest of the app.
 */
export default function Sheet({
  title, onClose, children, footer,
}: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg max-h-[90vh] flex flex-col bg-[#162032] border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button type="button" onClick={onClose} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-white/10 flex gap-2 justify-end">{footer}</div>}
      </div>
    </div>
  );
}

export const fieldClass =
  "w-full bg-[#0B1120] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#F97316]";
export const primaryBtn =
  "px-4 py-2.5 rounded-xl bg-[#F97316] hover:bg-orange-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors";
export const ghostBtn =
  "px-4 py-2.5 rounded-xl border border-white/10 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors";
