import { useCallback, useState } from "react";
import { loadPaperOverride, savePaperOverride, type PaperSizeKey } from "../lib/printPaper";

/**
 * Per-print paper size, remembered for this browser. Starts on whatever was
 * last picked next to the Print button (null = the center's Settings → Invoice
 * Printing default), so a shop that prints most invoices on the A4 laser
 * doesn't re-pick it on every invoice.
 */
export function usePaperOverride(): [PaperSizeKey | null, (key: PaperSizeKey | null) => void] {
  const [override, setOverride] = useState<PaperSizeKey | null>(() => loadPaperOverride());
  const set = useCallback((key: PaperSizeKey | null) => {
    savePaperOverride(key);
    setOverride(key);
  }, []);
  return [override, set];
}
