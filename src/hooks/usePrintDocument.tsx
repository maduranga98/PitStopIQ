import { useCallback, useRef, useState } from "react";
import { hasSeenPrintSetup, markPrintSetupSeen, printDocument } from "../lib/printDocument";
import PrintSetupDialog from "../components/print/PrintSetupDialog";

/**
 * The Print button's behaviour, in one place.
 *
 * Printing a document from PitStop IQ is never just `window.print()`: the
 * browser's own header and footer have to be dealt with first (see
 * lib/printDocument.ts). This hook
 *
 *   • names the print after the document, not after the app, so the browser's
 *     header — and the filename under "Save as PDF" — reads "2026-08-0001-INV";
 *   • shows the one-time setup steps before the very first print in a browser,
 *     because turning the header and footer off is a dialog setting no page
 *     can reach.
 *
 * `title` is the document's own number/name; pass null while it is still
 * loading. `paperLabel` is only used in the dialog copy.
 *
 * ```tsx
 * const { print, setupDialog } = usePrintDocument(invoice?.invoiceNumber, paper.label);
 * // <button onClick={print}>Print</button>
 * // {setupDialog}
 * ```
 */
export function usePrintDocument(title?: string | null, paperLabel?: string) {
  const [asking, setAsking] = useState(false);
  // Read once per mount: a print that has just marked the flag must not
  // re-open the dialog, and the flag can't change from another tab mid-print.
  const seen = useRef(hasSeenPrintSetup());

  const run = useCallback(() => printDocument(title), [title]);

  const print = useCallback(() => {
    if (seen.current) { run(); return; }
    setAsking(true);
  }, [run]);

  /** Re-opens the steps on demand, for the "Print setup" link. */
  const showSetup = useCallback(() => setAsking(true), []);

  const setupDialog = asking ? (
    <PrintSetupDialog
      paperLabel={paperLabel}
      onCancel={() => setAsking(false)}
      onContinue={(remember) => {
        if (remember) { markPrintSetupSeen(); seen.current = true; }
        setAsking(false);
        // Let the dialog leave the DOM before the print dialog freezes the
        // page, or it is captured in the preview behind the invoice.
        requestAnimationFrame(() => requestAnimationFrame(run));
      }}
    />
  ) : null;

  return { print, showSetup, setupDialog };
}
