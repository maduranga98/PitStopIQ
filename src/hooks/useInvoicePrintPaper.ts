import { useEffect } from "react";
import {
  buildPageRule, resolvePaper, resolvePaperWithOverride,
  PAGE_RULE_STYLE_ID, type PaperSizeKey, type ResolvedPaper,
} from "../lib/printPaper";

/**
 * Owns the @page rule for a printable invoice.
 *
 * It lives in a <style> in <head> rather than in the component's own
 * stylesheet because @page is a document-level rule: a stylesheet React
 * renders inside the page works, but keeping the one rule that decides the
 * paper in a single, known element is what lets it be swapped when the size
 * picker changes without touching the invoice's own CSS.
 *
 * Pass the center document (or anything carrying `invoicePaper`); the resolved
 * paper is returned for the component's own print CSS. `override` is the size
 * picked next to the Print button for this one invoice — null follows the
 * center's Settings → Invoice Printing default.
 */
export function useInvoicePrintPaper(
  source: Parameters<typeof resolvePaper>[0],
  override: PaperSizeKey | null = null,
): ResolvedPaper {
  const paper = resolvePaperWithOverride(source, override);
  const { widthMm, heightMm, marginMm, receipt, key } = paper;

  useEffect(() => {
    const resolved: ResolvedPaper = {
      key, label: "", widthMm, heightMm, marginMm, receipt,
    };

    const style = document.getElementById(PAGE_RULE_STYLE_ID) as HTMLStyleElement
      ?? Object.assign(document.createElement("style"), { id: PAGE_RULE_STYLE_ID });
    if (!style.isConnected) document.head.appendChild(style);
    style.textContent = buildPageRule(resolved);

    return () => style.remove();
  }, [key, widthMm, heightMm, marginMm, receipt]);

  return paper;
}
