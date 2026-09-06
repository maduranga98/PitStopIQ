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
  /** Payment / settlement list under the totals. */
  payments: "ip-payments",
  /** "Thank you for your business" block and the branding line under it. */
  footer: "ip-footer",
} as const;

/** Id of the <style> element that carries the (dynamic) @page rule. */
export const PAGE_RULE_STYLE_ID = "ip-page-rule";

/**
 * The @page rule.
 *
 * A fixed sheet gets its exact size. A continuous roll deliberately gets
 * `size: auto` instead of a measured height: Chrome and Edge always print on
 * the paper chosen in the print dialog, and when the declared page box is
 * shorter than that paper they lay the box out inside it rather than at the
 * top — which is where the band of blank paper above and below a short receipt
 * came from. With `auto` the page box *is* the selected paper, so the receipt
 * starts at the very top edge and the only paper after it is whatever the
 * chosen paper length carries past the end of the bill.
 */
export function buildPageRule(paper: ResolvedPaper): string {
  // margin: 0 — the invoice keeps its own white edge as padding instead. A
  // page box with no margin is also what stops Chrome printing its header and
  // footer (the date, the page title, the URL, "1/1") around the invoice.
  const size = paper.heightMm === null
    ? "auto"
    : `${round(paper.widthMm)}mm ${round(paper.heightMm)}mm`;
  return `@page { size: ${size}; margin: 0; }`;
}

function round(mm: number): number {
  return Math.round(mm * 10) / 10;
}

/**
 * The print stylesheet for a printable invoice, minus the @page rule (that one
 * is injected into <head> by usePrintPaper, which recomputes it right before
 * printing). `rootId` is the id of the print-only container, which must be a
 * direct child of <body> (see InvoicePrintRoot) — every other child of <body>
 * is taken out of the print entirely.
 */
export function buildInvoicePrintCss(paper: ResolvedPaper, rootId = "invoice-print"): string {
  const root = `#${rootId}`;

  return `
    @media print {
      html, body {
        background: #fff !important;
        margin: 0 !important;
        padding: 0 !important;
        height: auto !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      /*
       * The app is taken out of the flow (display:none), not merely made
       * invisible. Hiding it by visibility left the sidebar, the sticky page
       * header and #root's min-height:100vh still holding their boxes, so the
       * invoice had to be lifted out with position:absolute to sit at the top
       * left of the paper — and an out-of-flow box is the fragile way to
       * spread a document over several pages. With everything else gone the
       * invoice stays in normal flow, which is where page fragmentation is
       * defined, and it starts at the top of the paper on its own.
       *
       * The display:block here also stops the print depending on Tailwind's
       * print:block utility being the last rule to win.
       */
      body > *:not(${root}) { display: none !important; }
      ${root} {
        display: block !important;
        position: static !important;
        /*
         * Nothing may cap or clip the invoice: a height inherited from the
         * screen layout, or a scroll container (an overflow-x:hidden column
         * scrolls on the other axis, which clips), prints the part that fits
         * and drops the rest — the invoice that "prints only half".
         */
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
      }
      html, body { overflow: visible !important; }
      .no-print { display: none !important; }

      /* Keep the fragmentation tidy once it does span pages. */
      ${root} table { page-break-inside: auto; break-inside: auto; }
      ${root} thead { display: table-header-group; }
      ${root} tr, ${root} img { page-break-inside: avoid; break-inside: avoid; }
      ${root} .${PRINT_CLASS.totals} { page-break-inside: avoid; break-inside: avoid; }
    }

    ${layoutCss(root, paper)}
  `;
}

/** Rules that decide the shape of the printed invoice. */
function layoutCss(root: string, paper: ResolvedPaper): string {
  // Printing fills the paper the print dialog is actually set to, whatever
  // that is. Chrome takes the paper size from its own dialog and only reads
  // @page for orientation, so pinning the invoice to the configured width in
  // mm was the wrong bet both ways round: a 76mm receipt printed on A4 became
  // a narrow strip down the middle of a wasted sheet, and an A4 invoice sent
  // to a roll ran 186mm wide on 76mm paper and lost everything past the edge.
  // At 100% it fits either — on the right paper it is the same width it
  // always was. The @page margin is 0 and the white margin comes from this
  // padding, which also keeps Chrome from having room to stamp its date, page
  // title and URL along the edges of the invoice.
  const body = `
    ${root} {
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      padding: ${paper.marginMm}mm !important;
      margin: 0 !important;
      background: white;
      color: black;
      font-family: sans-serif;
    }
    ${root} img { max-width: 100% !important; }
    ${paper.receipt ? receiptCss(root) : ""}
  `;

  return `@media print {\n${body}\n}`;
}

/**
 * Narrow-roll overrides. The printable markup carries inline styles (font
 * sizes, paddings, a fixed-width totals block) sized for A4, so every rule
 * here has to be !important to win against them — the wide gaps a receipt used
 * to carry were A4 margins (a 48px gap over the footer, 32px over the payment
 * list) that no class-based rule could reach.
 *
 * Emitted unwrapped; layoutCss puts it behind @media print with the rest.
 */
function receiptCss(root: string): string {
  return `
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
      font-size: 9px !important;
      /* break-word, not break-all: an amount may fall to its own line but
         must never split down the middle ("LKR 12,500.0 / 0"). */
      word-break: normal !important;
      overflow-wrap: break-word !important;
      font-variant-numeric: tabular-nums;
    }
    ${root} th:first-child, ${root} td:first-child {
      width: 40% !important;
      overflow-wrap: anywhere !important;
    }
    ${root} th:nth-child(2), ${root} td:nth-child(2) { width: 10% !important; }
    ${root} th:nth-child(3), ${root} td:nth-child(3),
    ${root} th:nth-child(4), ${root} td:nth-child(4) { width: 25% !important; }

    /* Typography — Tailwind's page-sized steps are far too large here. */
    ${root} .text-2xl { font-size: 14px !important; }
    ${root} .text-xl  { font-size: 13px !important; }
    ${root} .text-lg  { font-size: 12px !important; }
    ${root} .text-sm, ${root} .text-xs { font-size: 10px !important; }

    /* Settlement / payment list. */
    ${root} .${PRINT_CLASS.payments} {
      margin-top: 8px !important;
      padding-top: 6px !important;
    }
    ${root} .${PRINT_CLASS.payments} > div { padding: 2px 0 !important; }

    /* Footer. On A4 it is held 48px clear of the bill and set in 13px; on a
       roll that gap alone is a fifth of the receipt. */
    ${root} .${PRINT_CLASS.footer} {
      margin-top: 8px !important;
      padding-top: 6px !important;
      font-size: 9px !important;
    }
    ${root} .${PRINT_CLASS.footer} + div { margin-top: 4px !important; }

    /* Spacing */
    ${root} .mb-8 { margin-bottom: 8px !important; }
    ${root} .mb-4 { margin-bottom: 6px !important; }
    ${root} .gap-8, ${root} .gap-4 { gap: 6px !important; }
    ${root} .pb-6 { padding-bottom: 6px !important; }
    /* Nothing may open the receipt with an A4-sized gap, and nothing may
       leave a trailing one: the roll is cut right after the last line. */
    ${root} > *:first-child { margin-top: 0 !important; }
    ${root} > *:last-child { margin-bottom: 0 !important; }
  `;
}

// ── Per-print size override ──────────────────────────────────────────────────
// Settings → Invoice Printing is the shop's standing default, but a single
// invoice often has to come out on something else: the A4 laser is free, or a
// customer wants a full sheet of a receipt that normally goes on the 76mm
// roll. The picker next to the Print button writes the chosen size here; it is
// remembered per browser (not on the center document) so one clerk's one-off
// choice never changes what the rest of the shop prints.

/** Sizes offered in the per-print picker. "custom" is settings-only. */
export const PRINT_PICKER_SIZES: Exclude<PaperSizeKey, "custom">[] = [
  "a4", "a5", "letter", "thermal80", "thermal76", "thermal58",
];

const OVERRIDE_STORAGE_KEY = "pitstopiq.invoicePaperSize";

/** Reads the remembered per-print size. null = follow the center setting. */
export function loadPaperOverride(): PaperSizeKey | null {
  try {
    const raw = localStorage.getItem(OVERRIDE_STORAGE_KEY);
    if (!raw) return null;
    return (PRINT_PICKER_SIZES as string[]).includes(raw) ? (raw as PaperSizeKey) : null;
  } catch {
    // Private mode / storage disabled — the center default is a fine fallback.
    return null;
  }
}

/** Remembers (or clears, with null) the per-print size for this browser. */
export function savePaperOverride(key: PaperSizeKey | null): void {
  try {
    if (key === null) localStorage.removeItem(OVERRIDE_STORAGE_KEY);
    else localStorage.setItem(OVERRIDE_STORAGE_KEY, key);
  } catch {
    /* nothing to do — the choice just won't survive a reload */
  }
}

/**
 * Applies a per-print size on top of the center's stored settings. The margin
 * the center configured is deliberately dropped with the size it belonged to:
 * a 3mm roll margin on an A4 sheet (or an A4 margin on a 58mm roll) prints
 * nothing like either paper, so an overridden size uses its own default.
 */
export function resolvePaperWithOverride(
  source: { invoicePaper?: InvoicePaperSettings } | null | undefined,
  override: PaperSizeKey | null | undefined,
): ResolvedPaper {
  if (!override) return resolvePaper(source);
  return resolvePaper({ invoicePaper: { size: override } });
}
