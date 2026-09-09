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
  /** The shop's name, the largest line on the bill. */
  orgName: "ip-org-name",
  /** The shop's address line under its name in the header. */
  orgAddress: "ip-org-address",
  /** Bill-to / vehicle columns. */
  parties: "ip-parties",
  /** Right-aligned totals block. */
  totals: "ip-totals",
  /** The Grand Total row inside the totals block — the bill's headline figure. */
  grandTotal: "ip-grand-total",
  /** The total spelled out under the totals block. */
  amountWords: "ip-amount-words",
  /** Payment / settlement list under the totals. */
  payments: "ip-payments",
  /** "Thank you for your business" block and the branding line under it. */
  footer: "ip-footer",
  /** The one-line PitStop IQ credit that closes the bill. */
  brandLine: "ip-brand-line",
} as const;

/** Id of the <style> element that carries the (dynamic) @page rule. */
export const PAGE_RULE_STYLE_ID = "ip-page-rule";

/**
 * Put on <body> while the printable node is measured. It reveals the node
 * off-screen under the very same layout rules print uses, so the height we
 * measure is the height that will actually be printed.
 */
export const MEASURING_CLASS = "ip-measuring";

/** Fallback page height for a roll when the content can't be measured. */
const ROLL_FALLBACK_HEIGHT_MM = 297;

/** CSS px per mm — 1in is exactly 96 CSS px. */
const PX_PER_MM = 96 / 25.4;

/**
 * The @page rule. `size` must always be two lengths: `<width> auto` is not
 * valid CSS, and a browser that sees it drops the whole declaration and prints
 * on its default paper — which is exactly what a roll printer must not do. A
 * continuous roll therefore gets a concrete height, measured from the rendered
 * invoice where possible so no blank paper is fed after it.
 *
 * Plain `size: auto` is not the answer either, tempting as it looks: it makes
 * the page box whatever paper the driver is set to, and a roll driver's form
 * is often its maximum length (the XP-76 ships a 76 × 3276 mm form). The
 * browser then renders one 3.3 m page — metres of blank paper, and a raster
 * big enough that the print can come out empty. A page measured from the bill
 * is small whatever the driver claims its paper is.
 */
export function buildPageRule(paper: ResolvedPaper, measuredHeightMm?: number | null): string {
  const heightMm = paper.heightMm
    ?? (measuredHeightMm && measuredHeightMm > 0 ? measuredHeightMm : ROLL_FALLBACK_HEIGHT_MM);
  // margin: 0 — the invoice keeps its own white edge as padding instead. A
  // page box with no margin is also what stops Chrome printing its header and
  // footer (the date, the page title, the URL, "1/1") around the invoice.
  return `@page { size: ${round(paper.widthMm)}mm ${round(heightMm)}mm; margin: 0; }`;
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
  const measuring = `body.${MEASURING_CLASS}`;

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

    /* Off-screen measuring pass — same layout as print, just not visible. */
    ${measuring} ${root} {
      display: block !important;
      position: absolute !important;
      left: -10000px !important;
      top: 0 !important;
      visibility: hidden !important;
    }

    ${layoutCss(root, paper, `@media print`)}
    ${layoutCss(`${measuring} ${root}`, paper, "")}
  `;
}

/**
 * Rules that decide the shape of the printed invoice. Emitted twice — once for
 * print, once for the off-screen measuring pass — so the measured height and
 * the printed height are the same number.
 */
function layoutCss(root: string, paper: ResolvedPaper, wrapper: string): string {
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
  const box = wrapper
    ? `      width: 100% !important;
      max-width: 100% !important;`
    // The off-screen pass has no paper to fill, so it measures at the width
    // the roll is configured for.
    : `      width: ${round(paper.widthMm)}mm !important;
      max-width: ${round(paper.widthMm)}mm !important;`;

  const body = `
    ${root} {
${box}
      box-sizing: border-box !important;
      padding: ${paper.marginMm}mm !important;
      margin: 0 !important;
      background: white;
      color: black;
      font-family: sans-serif;
    }
    ${root} img { max-width: 100% !important; }
    /*
     * The shop's name and its address each belong on ONE line — that is how
     * they read on the bills these shops have handed over for years, and a
     * wrapped one that orphans its last word ("AUTO TOUCH MARINE / BAY",
     * "COLOMBO / 8") is what made the print look broken. The name is the worst
     * of the three, because it is set largest and is the first thing anyone
     * looks at. They are held on one line here and shrunk to fit by
     * fitPrintOneLiners() before each print; only a line too long even at its
     * floor size is allowed to wrap, and then on its own spaces.
     */
    ${root} .${PRINT_CLASS.orgName},
    ${root} .${PRINT_CLASS.orgAddress},
    ${root} .${PRINT_CLASS.brandLine} {
      white-space: nowrap !important;
      overflow-wrap: normal !important;
      word-break: normal !important;
      hyphens: none !important;
    }
    /* Set by fitPrintOneLiners when even the floor size will not fit. */
    ${root} .${PRINT_CLASS.orgName}[data-ip-wrapped="1"],
    ${root} .${PRINT_CLASS.orgAddress}[data-ip-wrapped="1"],
    ${root} .${PRINT_CLASS.brandLine}[data-ip-wrapped="1"] {
      white-space: normal !important;
      overflow-wrap: break-word !important;
      text-wrap: pretty;
    }
    /* The total in words. It is the line a customer reads to check the
       figure, so it is never dropped to a caption size. */
    ${root} .${PRINT_CLASS.amountWords} {
      margin-top: 6px !important;
      text-align: right !important;
    }
    ${paper.receipt ? receiptCss(root, paper) : ""}
  `;

  return wrapper ? `${wrapper} {\n${body}\n}` : body;
}

/**
 * Body size for the receipt layout on the paper it was drawn for, in CSS px.
 *
 * The one number the whole roll layout is stepped from, so a shop that finds
 * its head prints light has a single knob. 15px at 96 CSS px/in is 3.97mm of
 * line, a capital of about 2.8mm — ten dot rows on a 72 dpi head, which is
 * where a bold serif stops losing its joins, and the size the shop's previous
 * bill was printed at.
 */
const RECEIPT_BASE_PX = 15;

/** Content width the base size above was chosen against: a 76mm roll. */
const RECEIPT_DESIGN_WIDTH_MM = 70;

/** How far the base size may be scaled for a narrower or wider roll. */
const RECEIPT_BASE_LIMITS = { min: 11, max: 16 };

/**
 * The base size for a given roll.
 *
 * A receipt is not one layout at one size: 58mm carries 54mm of content where
 * 80mm carries 74, and the bill is four columns wide on both. Held at a flat
 * 15px the 58mm roll printed "12,500.0025,000.00" with the last figure off the
 * edge of the paper, "DESCRIPT / ION" in the heading and "GRAND / TOTAL" over
 * two lines — the columns had run out of room, not the type out of size. So
 * the size is scaled by how much paper there actually is.
 *
 * The floor is where legibility gives out on a coarse head; the ceiling stops
 * a wide roll from setting the bill in headline type. A shop that wants
 * something other than this on its own paper still has the one knob above.
 */
function receiptBasePx(paper: ResolvedPaper): number {
  const scaled = RECEIPT_BASE_PX * (contentWidthMm(paper) / RECEIPT_DESIGN_WIDTH_MM);
  return Math.round(
    clamp(scaled, RECEIPT_BASE_LIMITS.min, RECEIPT_BASE_LIMITS.max) * 4,
  ) / 4;
}

/**
 * Narrow-roll overrides. The printable markup carries inline styles (font
 * sizes, paddings, a fixed-width totals block) sized for A4, so every rule
 * here has to be !important to win against them.
 *
 * Emitted unwrapped: layoutCss puts it behind @media print for the real print
 * and leaves it unconditional for the off-screen measuring pass. Wrapping it
 * in its own @media print left the measuring pass laying a receipt out at A4
 * type sizes, so the page height a roll was given had nothing to do with the
 * receipt that then printed on it.
 */
function receiptCss(root: string, paper: ResolvedPaper): string {
  // Shadowing the module constant would be legal and confusing; this is the
  // size actually used, which for anything but a 76mm roll is not that one.
  const base = receiptBasePx(paper);
  return `
    /*
     * The face, and why it is a serif.
     *
     * A roll printer's vertical resolution is the low number in its quality
     * setting — 72 dpi on the XP-76 — so a letter is drawn with about a dozen
     * dot rows, and a proportional sans loses its thin joins between them:
     * the "chewed" capitals and the filled-in o/e of the first prints. The
     * bills these shops have handed over for years are set in bold Times, and
     * that is not nostalgia: a serif's stroke ends are wider than its stems,
     * so a glyph that half-lands on the dot grid still reads as that letter,
     * and bold puts two dot rows into every stem instead of one. Liberation
     * Serif and DejaVu Serif are the metric-compatible fallbacks for a
     * machine without Times.
     *
     * Everything on the bill is bold for the same reason — that is also how
     * the old bill prints, top to bottom.
     *
     * Size is the other half of it, and the half the first prints got wrong.
     * A glyph is only as sharp as the number of dot rows it is drawn with, so
     * at 72 dpi the size is not a matter of taste: 13px gave a capital about
     * seven rows tall, which is where a serif's brackets and a digit's bowl
     * stop resolving. receiptBasePx() sets it so a capital lands on roughly ten
     * — the height the shop's old bill prints at, and the size everything else
     * here is stepped from.
     *
     * font-synthesis:none stops the browser smearing a fake bold out of the
     * regular face when a weight is missing (a synthetic bold is drawn by
     * over-inking, which at this resolution is a blur). Hinting is deliberately
     * left on (no text-rendering override): geometricPrecision, which this
     * used to set, turns grid-fitting OFF and positions glyphs on fractional
     * pixels — every stem then straddles two dot rows and is printed as two
     * half-inked ones, which is the "chewed" look itself. The default lets the
     * rasteriser snap stems onto whole rows.
     *
     * A hair of tracking keeps the stems of adjacent letters from landing in
     * the same dot column and merging ("rn" printing as "m").
     */
    ${root} {
      font-family: "Times New Roman", "Liberation Serif", "DejaVu Serif", Times, serif !important;
      font-size: ${base}px !important;
      font-weight: 700 !important;
      line-height: 1.3 !important;
      letter-spacing: 0.01em !important;
      font-synthesis: none !important;
      -webkit-font-smoothing: none !important;
    }
    ${root} * {
      font-family: inherit !important;
      font-weight: 700 !important;
      font-synthesis: none !important;
      -webkit-font-smoothing: none !important;
    }
    ${root} * {
      max-width: 100% !important;
      letter-spacing: inherit !important;
    }

    /*
     * Caps, like the bill it replaces. A capital has no descender and almost
     * no fine detail below the cap line, so it survives a coarse dot grid far
     * better than a lowercase alphabet whose x-height is barely half as tall —
     * which is why every receipt printer's own resident font is drawn this
     * way. The total in words is the exception: it is a sentence, and a
     * sentence in caps is slower to read than the figure it is checking.
     */
    ${root} { text-transform: uppercase !important; }
    ${root} .${PRINT_CLASS.amountWords},
    ${root} .${PRINT_CLASS.brandLine} { text-transform: none !important; }
    /* The address is held to one line (see above) and shrunk to fit, so it
       starts a step down from the rest of the header. */
    /*
     * Doubled class, deliberately: the markup carries text-sm here as well,
     * the Tailwind-step block further down declares .text-sm at equal
     * specificity, and being later in the sheet it won — the address printed
     * a size larger than intended and overflowed the roll before the fitter
     * could get near it. The repeated class outranks it outright.
     */
    ${root} .${PRINT_CLASS.orgAddress}.${PRINT_CLASS.orgAddress} {
      font-size: ${base - 2}px !important;
      line-height: 1.3 !important;
    }
    /* The shop's name. Doubled class for the same reason as the address: it
       carries text-2xl, which the step block below declares at equal
       specificity and later in the sheet. This is only the starting size —
       fitPrintOneLiners steps it down from here until it fits the roll. */
    ${root} .${PRINT_CLASS.orgName}.${PRINT_CLASS.orgName} {
      font-size: ${base + 5}px !important;
      line-height: 1.2 !important;
    }
    /* The total in words closes the bill, centred under the figures the way
       the shop's old bill sets it. */
    ${root} .${PRINT_CLASS.amountWords} {
      margin-top: 4px !important;
      text-align: center !important;
      font-size: ${base - 1}px !important;
      line-height: 1.3 !important;
    }
    ${root} img {
      max-width: 40px !important;
      max-height: 40px !important;
    }

    /*
     * Ink, not colour. Every printer that takes a 58–80mm roll prints one
     * colour at a coarse resolution — the XP-76 is 160 x 72 dpi — so a grey
     * label (#9ca3af on the section headings, #6b7280 on the totals) and the
     * green/red of the paid and due lines come out as a dither pattern, which
     * on paper reads as blurred or half-missing letters. The page's whole
     * palette therefore collapses to solid black here, and the panel fills
     * (the table head's #f3f4f6, the status pill) go with it: a light fill is
     * dithered the same way and only muddies the text sitting on it. Colour
     * is what an A4 laser is for.
     */
    ${root} * {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      background: transparent !important;
      background-color: transparent !important;
      box-shadow: none !important;
      text-shadow: none !important;
    }
    ${root} *, ${root} *::before, ${root} *::after {
      border-color: #000 !important;
    }

    /* Restack everything that sits side by side on a full page. */
    ${root} .${PRINT_CLASS.header} {
      display: block !important;
      text-align: center !important;
      margin-bottom: 4px !important;
      padding-bottom: 3px !important;
    }
    ${root} .${PRINT_CLASS.header} > div {
      display: block !important;
      text-align: center !important;
      width: 100% !important;
    }
    ${root} .${PRINT_CLASS.parties} {
      display: block !important;
      margin-bottom: 4px !important;
    }
    ${root} .${PRINT_CLASS.parties} > div + div { margin-top: 3px !important; }
    ${root} .${PRINT_CLASS.totals} {
      max-width: 100% !important;
      width: 100% !important;
      margin-left: 0 !important;
    }
    ${root} .${PRINT_CLASS.totals} > div {
      padding: 0 !important;
      font-size: ${base}px !important;
    }
    /* The one figure the customer checks against the cash in their hand. It is
       set a step up from the rest, the way the old bill sets its FINAL VALUE,
       and the rule above must not flatten it back. */
    ${root} .${PRINT_CLASS.grandTotal} {
      font-size: ${base + 3}px !important;
      line-height: 1.25 !important;
      padding: 2px 0 !important;
      margin-top: 2px !important;
    }

    /* Line items: fixed layout so long descriptions wrap instead of
       pushing the price columns off the roll. */
    ${root} table {
      width: 100% !important;
      table-layout: fixed !important;
      margin-bottom: 4px !important;
    }
    ${root} th, ${root} td {
      padding: 2px 2px !important;
      font-size: ${base - 1}px !important;
      line-height: 1.3 !important;
      /* break-word, not break-all: an amount may fall to its own line but
         must never split down the middle ("LKR 12,500.0 / 0"). */
      word-break: normal !important;
      overflow-wrap: break-word !important;
      font-variant-numeric: tabular-nums;
    }
    /*
     * The amounts are bare numbers (the bill states its currency once, on the
     * Grand Total) and must never wrap: a figure broken over two lines is what
     * makes a receipt hard to read at a glance. They are also the columns that
     * set the widths, because a nowrap cell that is one pixel too narrow does
     * not shrink — it spills into its neighbour, and two figures printed with
     * no gap between them ("12,500.0025,000.00") is a bill nobody can check.
     * So the two money columns are sized for the widest figure a shop bills in
     * rupees, the qty column for a header that must stay on one line, and the
     * description takes what is left and wraps.
     */
    ${root} th:first-child, ${root} td:first-child {
      width: 39% !important;
      /* break-word, not anywhere: overflow-wrap:anywhere breaks at the first character
         that will not fit even when the whole word would fit on the next line,
         which printed "REPLACEME / NT". break-word moves the word down and
         only splits one that is wider than the column on its own. */
      overflow-wrap: break-word !important;
    }
    ${root} th:nth-child(2), ${root} td:nth-child(2) { width: 12% !important; }
    ${root} th:nth-child(3), ${root} td:nth-child(3),
    ${root} th:nth-child(4), ${root} td:nth-child(4) { width: 24.5% !important; }
    ${root} td:nth-child(3), ${root} td:nth-child(4) {
      white-space: nowrap !important;
    }
    /* A column heading is one short word and belongs on as few lines as the
       column allows; "QTY" split into "QT / Y" was the giveaway that the
       break-word above does not know a heading from a part description. */
    ${root} th { overflow-wrap: normal !important; hyphens: none !important; }

    /* Typography — Tailwind's page-sized steps are far too large here. */
    ${root} .text-2xl { font-size: ${base + 5}px !important; }
    ${root} .text-xl  { font-size: ${base + 2}px !important; }
    ${root} .text-lg  { font-size: ${base + 1}px !important; }
    ${root} .text-sm, ${root} .text-xs { font-size: ${base - 1}px !important; }

    /* Settlement / payment list. */
    ${root} .${PRINT_CLASS.payments} {
      margin-top: 5px !important;
      padding-top: 3px !important;
    }
    ${root} .${PRINT_CLASS.payments} > div { padding: 0 !important; }

    /* Footer. On A4 it is held 48px clear of the bill and set in 13px; on a
       roll that gap alone is a fifth of the receipt — and every millimetre of
       it is paper the shop feeds and tears off. */
    ${root} .${PRINT_CLASS.footer} {
      margin-top: 5px !important;
      padding-top: 3px !important;
      font-size: ${base - 2}px !important;
    }
    ${root} .${PRINT_CLASS.brandLine} {
      margin-top: 2px !important;
      font-size: ${base - 4}px !important;
      line-height: 1.3 !important;
    }

    /*
     * Spacing. Every gap here is paper the shop feeds and then tears off, so
     * the receipt is set as tight as it can be read at: the A4 rhythm (a 32px
     * gap above the payments, 48px above the footer, 24px under the table)
     * is a third of a receipt's length on its own.
     */
    ${root} .mb-8 { margin-bottom: 4px !important; }
    ${root} .mb-4 { margin-bottom: 3px !important; }
    ${root} .mt-1 { margin-top: 1px !important; }
    ${root} .mt-2 { margin-top: 2px !important; }
    ${root} .gap-8, ${root} .gap-4 { gap: 3px !important; }
    ${root} .pb-6 { padding-bottom: 3px !important; }
    ${root} .py-1 { padding-top: 0 !important; padding-bottom: 0 !important; }
    ${root} .px-3 { padding-left: 0 !important; padding-right: 0 !important; }
    /* The A4 markup carries its vertical rhythm as inline margins (24px above
       the payment list, 48px above the footer). They belong to a sheet. */
    ${root} .${PRINT_CLASS.totals} { margin-bottom: 0 !important; }
    /* Nothing may open the receipt with an A4-sized gap, and nothing may
       leave a trailing one: the page is exactly as long as the bill. */
    ${root} > *:first-child { margin-top: 0 !important; }
    ${root} > *:last-child { margin-bottom: 0 !important; }
  `;
}

/**
 * Smallest each fitted one-liner may shrink to before it is left to wrap.
 *
 * A floor each, because the three lines are not worth the same. The shop's
 * name is the masthead — it may come down to the size of the body text to stay
 * on one line, but no further, or the bill stops looking like that shop's
 * bill. The address is information a customer may have to act on, and on a
 * 72 dpi head a 7px capital is four dot rows — a smudge whether or not it fits
 * on one line, so it stops at nine and takes a second line if it must. The
 * PitStop IQ credit is small print nobody reads twice; keeping it to one line
 * is worth more than keeping it large, and every extra line is paper the shop
 * feeds and tears off.
 */
const MIN_FIT_PX: Record<string, number> = {
  [PRINT_CLASS.orgName]: 13,
  [PRINT_CLASS.orgAddress]: 9,
  [PRINT_CLASS.brandLine]: 7,
};

/** Floor for a fitted line whose class is not listed above. */
const DEFAULT_MIN_FIT_PX = 9;

/**
 * Fits the lines that must not wrap — the shop's name, its address, and the
 * PitStop IQ credit under the footer — onto one line each.
 *
 * All three are free-text fields: one shop is "ABC Motors" at "Colombo 6",
 * the next is "Auto Touch Marine Bay" on a lane, a road and a town, and no
 * single font size is right for both. So the size is chosen from the text that
 * is actually there — step each line down until it stops overflowing its
 * column, exactly like the shop's old printer, which set its header lines to
 * fit the paper.
 *
 * Measured under the print layout (the off-screen pass), so the width it fits
 * to is the width it will print at. A line too long even at its floor size
 * (see MIN_FIT_PX) is marked to wrap instead — an unreadably small line is
 * worse than two lines. Called before each print, and before the roll is
 * measured, so the page length accounts for the sizes they settled on.
 */
export function fitPrintOneLiners(rootId: string): void {
  if (typeof document === "undefined") return;
  const root = document.getElementById(rootId);
  if (!root) return;
  const fitted = Object.keys(MIN_FIT_PX);
  const nodes = root.querySelectorAll<HTMLElement>(fitted.map((c) => `.${c}`).join(", "));
  if (nodes.length === 0) return;

  document.body.classList.add(MEASURING_CLASS);
  try {
    nodes.forEach((el) => {
      // Start from the stylesheet's own size every time: this runs again on
      // every print, and a size left over from a narrower paper would only
      // ever shrink further.
      el.style.removeProperty("font-size");
      el.removeAttribute("data-ip-wrapped");
      let size = parseFloat(getComputedStyle(el).fontSize);
      if (!isFinite(size) || size <= 0) return;

      const floor = MIN_FIT_PX[fitted.find((c) => el.classList.contains(c)) ?? ""]
        ?? DEFAULT_MIN_FIT_PX;

      // scrollWidth exceeds clientWidth exactly when the (nowrap) line runs
      // past its column. Half a pixel of slack absorbs sub-pixel rounding.
      while (el.scrollWidth > el.clientWidth + 0.5 && size > floor) {
        size = Math.max(floor, size - 0.25);
        // setProperty with "important", not el.style.fontSize: the receipt
        // stylesheet declares these sizes !important (it has to, to beat the
        // inline A4 styles in the markup), and a plain inline declaration
        // loses to an important one. Assigning .fontSize therefore changed
        // nothing at all — the loop ran to the floor, the line still
        // overflowed, and every address was handed to the wrap fallback.
        el.style.setProperty("font-size", `${size}px`, "important");
      }
      if (el.scrollWidth > el.clientWidth + 0.5) {
        // Longer than the paper at any readable size — let it wrap on its
        // own spaces rather than print a line nobody can read.
        el.style.removeProperty("font-size");
        el.setAttribute("data-ip-wrapped", "1");
      }
    });
  } finally {
    document.body.classList.remove(MEASURING_CLASS);
  }
}

/**
 * Measures how tall the printed invoice will be, in mm, by revealing the print
 * node off-screen under the print layout rules. Returns null when the node
 * isn't in the DOM (or has no height), in which case the caller falls back to
 * a fixed page height.
 */
export function measurePrintHeightMm(rootId: string): number | null {
  if (typeof document === "undefined") return null;
  const el = document.getElementById(rootId);
  if (!el) return null;

  document.body.classList.add(MEASURING_CLASS);
  let heightPx: number;
  try {
    heightPx = el.scrollHeight;
  } finally {
    document.body.classList.remove(MEASURING_CLASS);
  }
  if (!heightPx) return null;

  // The measured box already carries the invoice's padding, and the page has
  // no margin of its own. A hair of slack keeps a rounding error from
  // spilling onto a second page.
  return heightPx / PX_PER_MM + 2;
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
