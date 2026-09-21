import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * The dialog shell the Management screens share — backdrop, panel, header and
 * Escape-to-close in one place, so each dialog is only its own content.
 */
export default function AdminModal({
  title, icon, onClose, children, footer, size = "md",
}: {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const width = {
    sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl",
  }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className={`relative bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl w-full ${width} max-h-[90vh] flex flex-col`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            {icon}
            {title}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>
  );
}

/** Shared field chrome — the admin portal's inputs all look like this. */
export const inputClass =
  "w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white " +
  "placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors [color-scheme:dark]";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-400 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-600 mt-1">{hint}</span>}
    </label>
  );
}
