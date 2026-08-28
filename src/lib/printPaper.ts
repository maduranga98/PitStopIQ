// ── Invoice paper size ───────────────────────────────────────────────────────
// A center prints its invoices on whatever it owns: an A4 laser, a 76mm dot
// matrix roll, an 80mm thermal receipt printer. The size is stored on the
// center document (Settings → Invoice Printing) and turned into the @page /
// @media print CSS that every printable invoice injects, so a print always
// comes out at the paper the shop actually loaded.

export type PaperSizeKey =
  | "a4" | "a5" | "letter"
  | "thermal80" | "thermal76" | "thermal58"
  | "custom";

export interface PaperSpec {
  key: PaperSizeKey;
  label: string;
  /** Physical paper width in mm. */
  widthMm: number;
  /** Physical height in mm, or null for a continuous roll. */
  heightMm: number | null;
  /** Default page margin in mm. Overridable per center. */
  marginMm: number;
  /**
   * Narrow paper needs a wholly different layout — one column, tighter type,
   * no right-aligned totals block. Anything at or below RECEIPT_MAX_WIDTH_MM
   * is laid out as a receipt.
   */
  receipt: boolean;
  /** Shown under the option in Settings. */
  description: string;
}

/** At or below this width the invoice is rendered as a receipt, not a page. */
export const RECEIPT_MAX_WIDTH_MM = 100;

export const DEFAULT_PAPER_SIZE: PaperSizeKey = "a4";

export const PAPER_SIZES: Record<Exclude<PaperSizeKey, "custom">, PaperSpec> = {
  a4: {
    key: "a4", label: "A4", widthMm: 210, heightMm: 297, marginMm: 12,
    receipt: false, description: "210 × 297 mm — standard office printer",
  },
  a5: {
    key: "a5", label: "A5", widthMm: 148, heightMm: 210, marginMm: 10,
    receipt: false, description: "148 × 210 mm — half sheet",
  },
  letter: {
    key: "letter", label: "Letter", widthMm: 216, heightMm: 279, marginMm: 12,
    receipt: false, description: "216 × 279 mm — US Letter",
  },
  thermal80: {
    key: "thermal80", label: "80 mm roll", widthMm: 80, heightMm: null, marginMm: 3,
    receipt: true, description: "80 mm thermal / POS receipt roll",
  },
  thermal76: {
    key: "thermal76", label: "76 mm roll", widthMm: 76, heightMm: null, marginMm: 3,
    receipt: true, description: "76 mm dot-matrix / thermal roll",
  },
  thermal58: {
    key: "thermal58", label: "58 mm roll", widthMm: 58, heightMm: null, marginMm: 2,
    receipt: true, description: "58 mm mini thermal roll",
  },
};

export const PAPER_SIZE_ORDER: PaperSizeKey[] = [
  "a4", "a5", "letter", "thermal80", "thermal76", "thermal58", "custom",
];

/** Custom paper falls back to these when the center hasn't typed its own. */
export const CUSTOM_PAPER_DEFAULTS = { widthMm: 80, heightMm: null as number | null, marginMm: 4 };

/** Bounds for the custom width/height/margin inputs. */
export const PAPER_LIMITS = {
  minWidthMm: 40, maxWidthMm: 420,
  minHeightMm: 40, maxHeightMm: 1200,
  minMarginMm: 0, maxMarginMm: 40,
};

/** The fields written onto the service center document. */
export interface InvoicePaperSettings {
  size: PaperSizeKey;
  /** Custom paper only. */
  widthMm?: number;
  /** Custom paper only. null/undefined = continuous roll. */
  heightMm?: number | null;
  /** Overrides the size's default margin when set. */
  marginMm?: number;
}

/** A fully resolved paper, ready to turn into CSS. */
export interface ResolvedPaper {
  key: PaperSizeKey;
  label: string;
  widthMm: number;
  heightMm: number | null;
  marginMm: number;
  receipt: boolean;
}

function num(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Reads the paper settings off a center document (or anything shaped like
 * one) and fills in every default. Always returns a usable paper — an
 * unrecognised or missing setting resolves to A4.
 */
export function resolvePaper(source: { invoicePaper?: InvoicePaperSettings } | null | undefined): ResolvedPaper {
  const stored = source?.invoicePaper;
  const key = (stored?.size ?? DEFAULT_PAPER_SIZE) as PaperSizeKey;

  if (key === "custom") {
    const widthMm = clamp(
      num(stored?.widthMm) ?? CUSTOM_PAPER_DEFAULTS.widthMm,
      PAPER_LIMITS.minWidthMm, PAPER_LIMITS.maxWidthMm,
    );
    const rawHeight = num(stored?.heightMm);
    const heightMm = rawHeight === null || rawHeight <= 0
      ? null
      : clamp(rawHeight, PAPER_LIMITS.minHeightMm, PAPER_LIMITS.maxHeightMm);
    const marginMm = clamp(
      num(stored?.marginMm) ?? CUSTOM_PAPER_DEFAULTS.marginMm,
      PAPER_LIMITS.minMarginMm, PAPER_LIMITS.maxMarginMm,
    );
    return {
      key, label: heightMm ? `${widthMm} × ${heightMm} mm` : `${widthMm} mm roll`,
      widthMm, heightMm, marginMm,
      receipt: widthMm <= RECEIPT_MAX_WIDTH_MM,
    };
  }

  const spec = PAPER_SIZES[key as Exclude<PaperSizeKey, "custom">] ?? PAPER_SIZES.a4;
  const marginMm = num(stored?.marginMm) === null
    ? spec.marginMm
    : clamp(num(stored?.marginMm)!, PAPER_LIMITS.minMarginMm, PAPER_LIMITS.maxMarginMm);

  return {
    key: spec.key, label: spec.label,
    widthMm: spec.widthMm, heightMm: spec.heightMm,
    marginMm, receipt: spec.receipt,
  };
}

/** Content width once the page margins are taken off. */
export function contentWidthMm(paper: ResolvedPaper): number {
  return Math.max(20, paper.widthMm - paper.marginMm * 2);
}

// Class hooks the printable invoice markup carries so the receipt layout can
// restack the parts that are side by side on a full page.
export const PRINT_CLASS = {
  /** Center details vs. invoice number row at the top. */
  header: "ip-header",
  /** Bill-to / vehicle columns. */
  parties: "ip-parties",
  /** Right-aligned totals block. */
  totals: "ip-totals",
} as const;

/**
 * The complete print stylesheet for a printable invoice. `rootId` is the id of
 * the print-only container (everything else on the page is hidden).
 */
export function buildInvoicePrintCss(paper: ResolvedPaper, rootId = "invoice-print"): string {
  const root = `#${rootId}`;
  // A continuous roll has no page height. `auto` keeps the browser from
  // padding each receipt out to a full sheet.
  const size = paper.heightMm
    ? `${paper.widthMm}mm ${paper.heightMm}mm`
    : `${paper.widthMm}mm auto`;

  return `
    @page {
      size: ${size};
      margin: ${paper.marginMm}mm;
    }
    @media print {
      html, body {
        background: #fff !important;
        margin: 0 !important;
        padding: 0 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body * { visibility: hidden !important; }
      ${root}, ${root} * { visibility: visible !important; }
      ${root} {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        padding: 0 !important;
        margin: 0 !important;
        background: white;
        color: black;
        font-family: sans-serif;
      }
      ${root} img { max-width: 100% !important; }
      .no-print { display: none !important; }
    }
    ${paper.receipt ? receiptCss(root) : ""}
  `;
}

/**
 * Narrow-roll overrides. The printable markup carries inline styles (font
 * sizes, paddings, a fixed-width totals block) sized for A4, so every rule
 * here has to be !important to win against them.
 */
function receiptCss(root: string): string {
  return `
    @media print {
      ${root} {
        font-size: 11px !important;
        line-height: 1.35 !important;
      }
      ${root} * {
        max-width: 100% !important;
        letter-spacing: 0 !important;
      }
      ${root} img {
        max-width: 40px !important;
        max-height: 40px !important;
      }

      /* Restack everything that sits side by side on a full page. */
      ${root} .${PRINT_CLASS.header} {
        display: block !important;
        text-align: center !important;
        margin-bottom: 8px !important;
        padding-bottom: 6px !important;
      }
      ${root} .${PRINT_CLASS.header} > div {
        display: block !important;
        text-align: center !important;
        width: 100% !important;
      }
      ${root} .${PRINT_CLASS.parties} {
        display: block !important;
        margin-bottom: 8px !important;
      }
      ${root} .${PRINT_CLASS.parties} > div + div { margin-top: 6px !important; }
      ${root} .${PRINT_CLASS.totals} {
        max-width: 100% !important;
        width: 100% !important;
        margin-left: 0 !important;
      }
      ${root} .${PRINT_CLASS.totals} > div {
        padding: 2px 0 !important;
        font-size: 11px !important;
      }

      /* Line items: fixed layout so long descriptions wrap instead of
         pushing the price columns off the roll. */
      ${root} table {
        width: 100% !important;
        table-layout: fixed !important;
        margin-bottom: 8px !important;
      }
      ${root} th, ${root} td {
        padding: 3px 2px !important;
        font-size: 10px !important;
        word-break: break-word !important;
      }
      ${root} th:first-child, ${root} td:first-child { width: 44% !important; }

      /* Typography — Tailwind's page-sized steps are far too large here. */
      ${root} .text-2xl { font-size: 14px !important; }
      ${root} .text-xl  { font-size: 13px !important; }
      ${root} .text-lg  { font-size: 12px !important; }
      ${root} .text-sm, ${root} .text-xs { font-size: 10px !important; }

      /* Spacing */
      ${root} .mb-8 { margin-bottom: 8px !important; }
      ${root} .mb-4 { margin-bottom: 6px !important; }
      ${root} .gap-8, ${root} .gap-4 { gap: 6px !important; }
      ${root} .pb-6 { padding-bottom: 6px !important; }
    }
  `;
}
