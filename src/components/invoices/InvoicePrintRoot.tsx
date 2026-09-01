import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The print-only copy of an invoice, rendered straight into <body>.
 *
 * It has to be a direct child of <body> for the print CSS to work: printing
 * hides every other child of <body> outright (display:none), so nothing is
 * left holding a box beside the invoice and it can stay in the normal flow,
 * where breaking across pages is well defined. Left where the page renders it
 * — inside the sidebar layout, inside an overflow-x-hidden scroll container —
 * the only way to get it to the top left of the paper was to take it out of
 * the flow with position:absolute.
 */
export default function InvoicePrintRoot({ id = "invoice-print", children }: {
  id?: string;
  children: ReactNode;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div id={id} className="hidden print:block bg-white text-black">{children}</div>,
    document.body,
  );
}
