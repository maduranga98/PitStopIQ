// ── Inspection Reports: logic shared by the app and the Cloud Functions ───────
//
// The Finalize button in the app and finalizeInspectionReport on the server
// must agree on what "ready to finalize" means, so the check lives here once
// (same arrangement as phone.mjs). Pure functions only — no Firebase, no I/O —
// which is also what lets inspectionHelpers.test.mjs run them directly.

/** Mirrors MEDIA_RETENTION_MONTHS in src/constants/inspectionReports.ts. */
export const MEDIA_RETENTION_MONTHS = 12;
export const REPORT_NUMBER_PREFIX = "INS";
/** Report numbers restart each year; the year is the workshop's, not the server's. */
export const REPORT_TIME_ZONE = "Asia/Colombo";

/** `date` plus `n` calendar months, clamped to the target month's last day
 *  (31 Jan + 1 month = 28/29 Feb, never 3 March). */
export function addMonths(date, n) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** The calendar year `date` falls in, in `timeZone`. */
export function yearInZone(date, timeZone = REPORT_TIME_ZONE) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(date));
}

/** "INS-2026-0007". Past 9999 the sequence simply gets wider. */
export function formatReportNumber(year, seq) {
  return `${REPORT_NUMBER_PREFIX}-${year}-${String(seq).padStart(4, "0")}`;
}

/** Ids of every item the inspector has to answer: snapshot items + report-only items. */
export function checklistItemIds(report) {
  const ids = [];
  for (const section of report.templateSnapshot ?? []) {
    for (const item of section.items ?? []) ids.push(item.id);
  }
  for (const extra of report.reportOnlyItems ?? []) ids.push(extra.id);
  return ids;
}

export function unansweredItemCount(report) {
  const results = report.results ?? {};
  return checklistItemIds(report).filter((id) => !results[id]?.status).length;
}

/** Items answered "needs repair" — the count shown beside a report in the portal. */
export function needsRepairCount(report) {
  const results = report.results ?? {};
  return checklistItemIds(report).filter((id) => results[id]?.status === "needs_repair").length;
}

/** Media still waiting in the offline upload queue (no URL yet, not expired). */
export function pendingMediaCount(report) {
  return Object.values(report.media ?? {}).filter((m) => m && m.pending === true && !m.url && !m.mediaDeleted).length;
}

/**
 * Why a draft can't be finalized yet — empty when it can. Messages are written
 * for the person reading them.
 */
export function finalizeBlockers(report) {
  const out = [];
  const open = unansweredItemCount(report);
  if (open > 0) out.push(`${open} checklist item${open === 1 ? " is" : "s are"} not answered. Mark each Meets, Repair or N/A.`);
  const pending = pendingMediaCount(report);
  if (pending > 0) out.push(`${pending} photo${pending === 1 ? " is" : "s are"} still uploading. Wait until you're online and they finish.`);
  if (report.type === "diagnostic" && !String(report.title ?? "").trim()) out.push("Add a short title for the diagnostic report.");
  return out;
}

/** Retention date for one media item finalized at `finalizedAt`; null for non-images. */
export function mediaDeleteAt(item, finalizedAt, months = MEDIA_RETENTION_MONTHS) {
  return item && typeof item.mimeType === "string" && item.mimeType.startsWith("image/")
    ? addMonths(finalizedAt, months)
    : null;
}

// ── PDF text ─────────────────────────────────────────────────────────────────
// The PDF uses PDFKit's built-in Helvetica (Latin only, by decision). Text in
// other scripts would otherwise render as garbage glyphs, so map common
// typographic characters to ASCII and show "?" for anything else.
const REPLACEMENTS = {
  "‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"',
  "–": "-", "—": "-", "−": "-", "…": "...", " ": " ", "•": "-",
  "→": "->", "×": "x",
};
export function pdfSafe(text) {
  let out = "";
  for (const ch of String(text ?? "")) {
    if (ch === "\n" || ch === "\t") { out += ch; continue; }
    if (REPLACEMENTS[ch] !== undefined) { out += REPLACEMENTS[ch]; continue; }
    const code = ch.codePointAt(0);
    // Printable ASCII and Latin-1 are in Helvetica's WinAnsi set; the rest isn't.
    out += (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) ? ch : (code < 0x20 ? "" : "?");
  }
  return out;
}
