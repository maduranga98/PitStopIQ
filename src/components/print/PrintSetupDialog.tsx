import { useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";

/**
 * The one-time walkthrough for the browser's own print header and footer.
 *
 * A web page cannot turn those off — they belong to the print dialog, and no
 * API exposes them — so the honest fix is to show the user the two settings
 * that do, once per browser, at the moment they are about to open that dialog.
 * "Don't show again" is on by default: this is a setting the browser then
 * remembers by itself, so nobody should have to read this twice.
 */
export default function PrintSetupDialog({ paperLabel, onCancel, onContinue }: {
  /** The paper the invoice is laid out for, e.g. "80 mm roll". */
  paperLabel?: string;
  onCancel: () => void;
  /** `remember` = don't offer these steps again in this browser. */
  onContinue: (remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(true);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 no-print print:hidden">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative w-full max-w-md bg-[#162032] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[#F97316]/15 text-[#F97316] shrink-0">
              <Printer className="w-4.5 h-4.5" />
            </span>
            <div>
              <h2 className="text-white font-semibold leading-tight">Print setup</h2>
              <p className="text-xs text-gray-400 mt-0.5">One-time, per browser</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="text-gray-500 hover:text-white transition p-1 -m-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-sm text-gray-300">
            Your browser prints its own date, page title, web address and page
            number around the invoice. Turn them off in the print window that
            opens next:
          </p>

          <ol className="mt-4 space-y-3">
            {[
              ["Open More settings", "It's at the bottom of the print window."],
              ["Set Margins to None", "This is what makes room for the invoice's own paper size."],
              ["Uncheck Headers and footers", "Removes the date, title, web address and page number."],
              paperLabel
                ? ["Set Paper size to " + paperLabel, "The dialog's paper wins over the invoice's."]
                : null,
            ].filter((s): s is [string, string] => s !== null).map(([title, hint], i) => (
              <li key={title} className="flex gap-3">
                <span className="flex items-center justify-center w-5 h-5 mt-0.5 shrink-0 rounded-full bg-white/10 text-[11px] font-semibold text-white">
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-medium text-white">{title}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{hint}</div>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-4 text-[11px] text-gray-500">
            Browsers remember these settings for next time. Safari calls them
            Show Headers and Footers under the printer options.
          </p>
        </div>

        <div className="px-5 py-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-white/20 bg-transparent accent-[#F97316]"
            />
            Don't show this again
          </label>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onCancel}
              className="text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              onClick={() => onContinue(remember)}
              className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
            >
              <Printer className="w-4 h-4" /> Continue
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
