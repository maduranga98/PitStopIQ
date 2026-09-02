// ── Browser print chrome ─────────────────────────────────────────────────────
// Chrome, Edge, Firefox and Safari stamp their own header and footer around
// whatever a page prints: the date and the document title along the top, the
// page URL and "1/1" along the bottom. On an A4 invoice they are ugly; on a
// 58/76/80mm roll they eat the paper the invoice was laid out for and push the
// content out of shape.
//
// No page can switch them off — they are a print-dialog setting, deliberately
// out of reach of script — so this module does the two things that are in
// reach:
//
//   1. The title half of the header is ours. `document.title` is what the
//      browser prints there (and what it names the file under "Save as PDF"),
//      so a print swaps the app name for the document's own number and puts it
//      back afterwards: "2026-08-0001-INV", not "PitstopIQ".
//   2. Everything else needs one setting changed once per browser, so the
//      first print walks the user through it (see PrintSetupDialog) and
//      remembers that they have seen it.
//
// The @page rule (margin: 0) that leaves the browser no room for its own
// chrome lives in printPaper.ts and still applies — it is what removes the
// header and footer outright in the browsers that honour it.

/** Remembers that this browser has been shown the print-setup steps. */
const TIP_STORAGE_KEY = "pitstopiq.printSetupSeen";

export function hasSeenPrintSetup(): boolean {
  try {
    return localStorage.getItem(TIP_STORAGE_KEY) === "1";
  } catch {
    // Private mode / storage disabled: treat as seen so the dialog can't
    // become a thing the user has to dismiss on every single print.
    return true;
  }
}

export function markPrintSetupSeen(): void {
  try {
    localStorage.setItem(TIP_STORAGE_KEY, "1");
  } catch {
    /* nothing to do — the dialog will offer itself again next time */
  }
}

/**
 * Trims a document title down to what a printed header and a saved-PDF
 * filename can carry: no path separators, no control characters, no runs of
 * whitespace. Returns null when nothing usable is left.
 */
function cleanTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const title = raw
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return title.length ? title : null;
}

/**
 * Prints the current document with `title` in place of the app name.
 *
 * The title is restored on `afterprint`. That event is reliable in every
 * current browser, but a print dialog the user never closes (or a tab that
 * loses the event) must not leave the tab titled after an invoice, hence the
 * timeout as a backstop. Both paths are idempotent.
 */
export function printDocument(title?: string | null): void {
  if (typeof window === "undefined") return;

  const wanted = cleanTitle(title);
  if (!wanted) {
    window.print();
    return;
  }

  const previous = document.title;
  document.title = wanted;

  let restored = false;
  let timer = 0;
  const restore = () => {
    if (restored) return;
    restored = true;
    window.removeEventListener("afterprint", restore);
    window.clearTimeout(timer);
    // Only put the old title back if nothing else has claimed it since (a
    // route change while the print dialog was open, say).
    if (document.title === wanted) document.title = previous;
  };

  // 5 minutes: long enough that it can never fire while a print preview is
  // still open, short enough that a lost afterprint self-heals.
  timer = window.setTimeout(restore, 5 * 60 * 1000);
  window.addEventListener("afterprint", restore);

  try {
    window.print();
  } catch {
    restore();
  }
}
