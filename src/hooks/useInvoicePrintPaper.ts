import { useEffect } from "react";
import {
  buildPageRule, measurePrintHeightMm, resolvePaper,
  PAGE_RULE_STYLE_ID, type ResolvedPaper,
} from "../lib/printPaper";

/**
 * Owns the @page rule for a printable invoice.
 *
 * It lives in a <style> in <head> rather than in the component's own stylesheet
 * because a continuous roll has no fixed page height: the rule is recomputed
 * from the rendered invoice on every `beforeprint` (which fires for Ctrl+P as
 * well as for our Print button), so a receipt gets a page exactly as long as
 * it needs and the printer feeds no blank paper after it.
 *
 * Pass the center document (or anything carrying `invoicePaper`); the resolved
 * paper is returned for the component's own print CSS.
 */
export function useInvoicePrintPaper(
  source: Parameters<typeof resolvePaper>[0],
  rootId = "invoice-print",
): ResolvedPaper {
  const paper = resolvePaper(source);
  const { widthMm, heightMm, marginMm, receipt, key } = paper;

  useEffect(() => {
    const resolved: ResolvedPaper = {
      key, label: "", widthMm, heightMm, marginMm, receipt,
    };

    const style = document.getElementById(PAGE_RULE_STYLE_ID) as HTMLStyleElement
      ?? Object.assign(document.createElement("style"), { id: PAGE_RULE_STYLE_ID });
    if (!style.isConnected) document.head.appendChild(style);

    function apply() {
      // A sheet has a known height; only a roll needs measuring.
      const measured = heightMm === null ? measurePrintHeightMm(rootId, marginMm) : null;
      style.textContent = buildPageRule(resolved, measured);
    }

    apply();
    window.addEventListener("beforeprint", apply);
    return () => {
      window.removeEventListener("beforeprint", apply);
      style.remove();
    };
  }, [key, widthMm, heightMm, marginMm, receipt, rootId]);

  return paper;
}
