// ── When a job card's bill is dated, and which sequence it is numbered in ─────
//
// A job card can stay open for days or weeks — paused for a part, waiting on a
// technician — so the moment it was OPENED and the moment the work was DONE can
// fall in different months, or different years (opened 28 Dec, completed
// 3 Jan). The bill belongs to the second of those: invoice dating and numbering
// are accounting records of when the work was completed and billed, not of when
// the job card was written up.
//
// Kept free of Firestore imports on purpose, so it can be unit-tested with
// plain `node --test` (see invoiceDating.test.ts).

/** The per-center, per-month sequence prefix an invoice raised at `at` belongs to, e.g. "INV-2027-01-". */
export function invoicePrefixFor(at: Date): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  return `INV-${year}-${month}-`;
}

/**
 * The next number in `prefix`'s sequence, given the highest number already
 * issued in it (or null when the sequence has not been started). A new month —
 * and so a new year — simply has no `last` yet, so it starts again at 0001.
 */
export function nextInvoiceNumber(prefix: string, last: string | null | undefined): string {
  let seq = 1;
  if (last && last.startsWith(prefix)) {
    const n = parseInt(last.slice(prefix.length), 10);
    if (!isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * The year an invoice number was issued in, or null when it carries none that
 * can be read. Covers both shapes this app mints:
 *   "INV-2026-12-0042"   — a bill raised at completion / at the counter
 *   "2026-12-0042-INV"   — the draft opened alongside a job card (jobCreation.ts)
 * (and any "XXX-2026-12-0042-INV" a center-specific job prefix produces).
 */
export function invoiceNumberYear(invoiceNumber: string | null | undefined): number | null {
  if (!invoiceNumber) return null;
  const m = /(?:^|\D)(\d{4})-(\d{2})-\d+/.exec(invoiceNumber);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? Number(m[1]) : null;
}

/**
 * Whether a job's still-unbilled draft must be moved into the completion
 * year's sequence. True only when the number it was opened with carries a
 * DIFFERENT year from the completion moment — the job that crossed New Year.
 * A number that can't be read is left alone rather than guessed at.
 */
export function needsCompletionYearNumber(
  invoiceNumber: string | null | undefined,
  completedAt: Date,
): boolean {
  const year = invoiceNumberYear(invoiceNumber);
  return year !== null && year !== completedAt.getFullYear();
}
