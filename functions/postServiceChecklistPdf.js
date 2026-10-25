/**
 * Post-service checklist report PDF (PDFKit). English only, same decision and
 * same reason as inspectionPdf.js: PDFKit's built-in Helvetica has no
 * Sinhala/Tamil glyphs, so text goes through pdfSafe and no fonts are bundled.
 *
 * Laid out like the paper General Inspection Report this replaces: each line has
 * three narrow columns — green (checked & OK), yellow (may require attention),
 * red (requires immediate attention) — with the mark in the column that was
 * chosen, so it reads at a glance and still works printed in grey (the three
 * marks differ in shape as well as colour). A section that records readings gets
 * a reading column; one that names a technician per line gets a name column.
 *
 * renderChecklistPdf is pure of Firebase: the caller passes plain JS values
 * (Dates, not Timestamps) and the logo as a Buffer (or null).
 *
 * Page order: header (logo, workshop, title, date) → vehicle / customer block →
 * legend and result summary → "needs attention" list → sections → remarks →
 * signature. Every page carries the workshop name and page x of y.
 */
const PDFDocument = require("pdfkit");
const { pdfSafe } = require("./shared/inspectionHelpers.mjs");

const PAGE = { w: 595.28, h: 841.89, margin: 40, footer: 28 };
const CONTENT_W = PAGE.w - PAGE.margin * 2;
const C = {
  text: "#1F2937", muted: "#6B7280", line: "#E5E7EB", band: "#F3F4F6",
  accent: "#F97316", gray: "#9CA3AF",
  ok: "#15803D", okTint: "#DCFCE7",
  attention: "#CA8A04", attentionTint: "#FEF9C3",
  immediate: "#B91C1C", immediateTint: "#FEE2E2",
};
const RESULTS = ["ok", "attention", "immediate"];
const RESULT_LABEL = { ok: "Checked & OK", attention: "May require attention", immediate: "Requires immediate attention" };
const COL = { result: 24, reading: 70, technician: 108 };
const ROW_MIN = 17;

const fmtDate = (d) => d
  ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short", year: "numeric" }).format(d)
  : "";

const bottom = () => PAGE.h - PAGE.margin - PAGE.footer;
const ensureSpace = (doc, h) => { if (doc.y + h > bottom()) doc.addPage(); };
const textH = (doc, text, width, font, size) => doc.font(font).fontSize(size).heightOfString(pdfSafe(text), { width });

/** One line that fits `width`: PDFKit's own ellipsis option wraps instead of clipping. */
function fit(doc, text, width, font, size) {
  const t = pdfSafe(text).replace(/\s+/g, " ").trim();
  doc.font(font).fontSize(size);
  if (doc.widthOfString(t) <= width) return t;
  let end = t.length;
  while (end > 1 && doc.widthOfString(`${t.slice(0, end)}...`) > width) end -= 1;
  return `${t.slice(0, end).trimEnd()}...`;
}

/** Marks are vectors (Helvetica has no check / cross glyphs) and differ in shape, not just colour. */
function drawMark(doc, status, cx, cy) {
  const fill = C[status];
  doc.save().circle(cx, cy, 6.2).fill(fill);
  doc.lineWidth(1.5).lineCap("round").lineJoin("round");
  if (status === "ok") {
    doc.moveTo(cx - 3, cy + 0.2).lineTo(cx - 0.8, cy + 2.6).lineTo(cx + 3.2, cy - 2.4).stroke("#FFFFFF");
  } else if (status === "attention") {
    doc.moveTo(cx, cy - 3.2).lineTo(cx, cy + 0.6).stroke("#FFFFFF");
    doc.circle(cx, cy + 2.8, 0.9).fill("#FFFFFF");
  } else {
    doc.moveTo(cx - 2.6, cy - 2.6).lineTo(cx + 2.6, cy + 2.6).moveTo(cx + 2.6, cy - 2.6).lineTo(cx - 2.6, cy + 2.6).stroke("#FFFFFF");
  }
  doc.restore();
}

function drawImageFit(doc, buf, x, y, w, h) {
  try {
    const img = doc.openImage(buf);
    const scale = Math.min(w / img.width, h / img.height);
    doc.image(img, x, y, { width: img.width * scale, height: img.height * scale });
    return true;
  } catch { return false; }
}

function sectionHeading(doc, title, cols) {
  const y = doc.y;
  doc.save().rect(PAGE.margin, y, CONTENT_W, 20).fill(C.band).restore();
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(C.text)
    .text(pdfSafe(title), PAGE.margin + 8, y + 5.5, { width: cols.labelW - 8, lineBreak: false });
  // The three result colours, so the columns below need no repeated header.
  RESULTS.forEach((r, i) => {
    doc.save().rect(cols.resultX + i * COL.result + 5, y + 6, COL.result - 10, 8).fill(C[`${r}Tint`]).restore();
    doc.save().rect(cols.resultX + i * COL.result + 5, y + 6, COL.result - 10, 8).lineWidth(0.6).stroke(C[r]).restore();
  });
  const small = (text, x, w) => doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(text, x, y + 6.5, { width: w, align: "center", lineBreak: false });
  if (cols.readingX !== null) small("Reading", cols.readingX, COL.reading);
  if (cols.techX !== null) small("Technician", cols.techX, COL.technician);
  doc.y = y + 22;
}

function drawRow(doc, item, section, cols) {
  const label = pdfSafe(item.label);
  const labelH = textH(doc, label, cols.labelW - 16, "Helvetica", 9.5);
  const h = Math.max(ROW_MIN, labelH + 6);
  ensureSpace(doc, h);
  const y = doc.y;

  doc.font("Helvetica").fontSize(9.5).fillColor(C.text).text(label, PAGE.margin + 8, y + (h - labelH) / 2, { width: cols.labelW - 16 });

  RESULTS.forEach((r, i) => {
    const x = cols.resultX + i * COL.result;
    doc.save().rect(x, y, COL.result, h).fill(C[`${r}Tint`]).restore();
    if (item.status === r) drawMark(doc, r, x + COL.result / 2, y + h / 2);
  });

  if (cols.readingX !== null && item.type === "status_numeric") {
    const text = item.value === null || item.value === undefined
      ? "-" : `${item.value}${item.unit ? ` ${pdfSafe(item.unit)}` : ""}`;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.text).text(text, cols.readingX, y + (h - 9) / 2, { width: COL.reading, align: "center", lineBreak: false });
  }
  if (cols.techX !== null) {
    doc.font("Helvetica").fontSize(8.5).fillColor(item.technicianName ? C.text : C.gray)
      .text(item.technicianName ? fit(doc, item.technicianName, COL.technician - 8, "Helvetica", 8.5) : "-",
        cols.techX + 4, y + (h - 8.5) / 2, { width: COL.technician - 8, lineBreak: false });
  }

  doc.save().moveTo(PAGE.margin, y + h).lineTo(PAGE.w - PAGE.margin, y + h).lineWidth(0.4).stroke(C.line).restore();
  doc.y = y + h;
}

function columnsFor(section) {
  const hasReading = section.items.some((i) => i.type === "status_numeric");
  const hasTech = section.hasTechnician === true;
  let right = PAGE.w - PAGE.margin;
  let techX = null, readingX = null;
  if (hasTech) { right -= COL.technician; techX = right; }
  if (hasReading) { right -= COL.reading; readingX = right; }
  const resultX = right - COL.result * 3;
  return { resultX, readingX, techX, labelW: resultX - PAGE.margin };
}

function paragraph(doc, title, text) {
  const t = pdfSafe(text).trim();
  if (!t) return;
  ensureSpace(doc, 48);
  const y = doc.y;
  doc.save().rect(PAGE.margin, y, CONTENT_W, 20).fill(C.band).restore();
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(C.text).text(pdfSafe(title), PAGE.margin + 8, y + 5.5, { width: CONTENT_W - 16, lineBreak: false });
  doc.y = y + 26;
  doc.font("Helvetica").fontSize(10).fillColor(C.text).text(t, PAGE.margin, doc.y, { width: CONTENT_W, lineGap: 2 });
  doc.moveDown(0.8);
}

/**
 * @param {object} args
 * @param {object} args.report  {title, header: {plate, customer, phone?, mileage?, date, reference?},
 *                               sections (filled), remarks, signerName, signedAt}
 * @param {{name: string, phone?: string, logo?: Buffer|null}} args.center
 * @returns {Promise<Buffer>}
 */
async function renderChecklistPdf({ report, center }) {
  const doc = new PDFDocument({
    size: "A4", margin: PAGE.margin, bufferPages: true, autoFirstPage: true,
    info: { Title: pdfSafe(report.title || "Post-service checklist"), Author: pdfSafe(center.name), Creator: "PitStopIQ" },
  });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });

  const sections = (report.sections ?? []).filter((s) => (s.items ?? []).length > 0);
  const lines = sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title })));
  const count = (st) => lines.filter((i) => i.status === st).length;

  // ── Header ────────────────────────────────────────────────────────────────
  let textX = PAGE.margin;
  if (center.logo && drawImageFit(doc, center.logo, PAGE.margin, PAGE.margin, 52, 52)) textX += 64;
  doc.font("Helvetica-Bold").fontSize(17).fillColor(C.text).text(pdfSafe(center.name), textX, PAGE.margin + 4, { width: 300, lineBreak: false });
  doc.font("Helvetica").fontSize(10).fillColor(C.muted).text("General Inspection Report", textX, PAGE.margin + 27, { width: 300, lineBreak: false });
  if (center.phone) doc.fontSize(9).text(pdfSafe(center.phone), textX, PAGE.margin + 41, { width: 300, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C.accent).text(pdfSafe(report.header?.plate) || "", PAGE.w - PAGE.margin - 200, PAGE.margin + 6, { width: 200, align: "right", lineBreak: false });
  doc.font("Helvetica").fontSize(9).fillColor(C.muted).text(fmtDate(report.header?.date), PAGE.w - PAGE.margin - 200, PAGE.margin + 24, { width: 200, align: "right", lineBreak: false });
  doc.save().moveTo(PAGE.margin, PAGE.margin + 62).lineTo(PAGE.w - PAGE.margin, PAGE.margin + 62).lineWidth(1).stroke(C.accent).restore();
  doc.y = PAGE.margin + 74;

  // ── Vehicle / customer block ──────────────────────────────────────────────
  const h = report.header ?? {};
  const cells = [
    ["Vehicle no.", h.plate], ["Date", fmtDate(h.date)],
    ["Customer", h.customer], ["Phone", h.phone],
    ["Mileage", h.mileage != null ? `${Number(h.mileage).toLocaleString("en-US")} km` : "-"], ["Reference", h.reference],
  ];
  const colW = CONTENT_W / 2;
  const top = doc.y;
  cells.forEach(([k, v], i) => {
    const x = PAGE.margin + (i % 2) * colW, y = top + Math.floor(i / 2) * 28;
    doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(k.toUpperCase(), x, y, { width: colW - 10, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(C.text).text(pdfSafe(v) || "-", x, y + 10, { width: colW - 10, lineBreak: false });
  });
  doc.y = top + Math.ceil(cells.length / 2) * 28 + 6;

  // ── Legend + summary ──────────────────────────────────────────────────────
  ensureSpace(doc, 50);
  let lx = PAGE.margin;
  const ly = doc.y;
  for (const r of RESULTS) {
    doc.save().rect(lx, ly, 14, 10).fill(C[r]).restore();
    doc.font("Helvetica").fontSize(8.5).fillColor(C.text).text(RESULT_LABEL[r], lx + 19, ly + 1, { lineBreak: false });
    lx += 19 + doc.widthOfString(RESULT_LABEL[r]) + 22;
  }
  doc.y = ly + 18;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(C.ok).text(`${count("ok")} OK`, PAGE.margin, doc.y, { continued: true })
    .fillColor(C.muted).text("   |   ", { continued: true })
    .fillColor(count("attention") ? C.attention : C.muted).text(`${count("attention")} may need attention`, { continued: true })
    .fillColor(C.muted).text("   |   ", { continued: true })
    .fillColor(count("immediate") ? C.immediate : C.muted).text(`${count("immediate")} need immediate attention`);
  doc.moveDown(0.8);

  const flagged = lines.filter((i) => i.status === "attention" || i.status === "immediate")
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "immediate" ? -1 : 1));
  if (flagged.length) {
    ensureSpace(doc, 48);
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(C.text).text("Needs attention", PAGE.margin, doc.y);
    doc.moveDown(0.4);
    for (const f of flagged) {
      ensureSpace(doc, 17);
      const y = doc.y;
      drawMark(doc, f.status, PAGE.margin + 10, y + 7);
      const reading = f.type === "status_numeric" && f.value != null ? `  (${f.value}${f.unit ? ` ${pdfSafe(f.unit)}` : ""})` : "";
      doc.font("Helvetica").fontSize(9.5).fillColor(C.text)
        .text(fit(doc, `${f.label}${reading}  -  ${f.section}`, CONTENT_W - 30, "Helvetica", 9.5), PAGE.margin + 26, y + 2, { width: CONTENT_W - 30, lineBreak: false });
      doc.y = y + 17;
    }
    doc.moveDown(0.6);
  }

  // ── Sections ──────────────────────────────────────────────────────────────
  for (const section of sections) {
    const cols = columnsFor(section);
    // Never strand a heading at the foot of a page: it travels with its first line.
    ensureSpace(doc, 22 + ROW_MIN * 2);
    sectionHeading(doc, section.title, cols);
    for (const item of section.items) drawRow(doc, item, section, cols);
    doc.y += 10;
  }

  // ── Remarks ───────────────────────────────────────────────────────────────
  paragraph(doc, "Remarks", report.remarks);

  // ── Signature ─────────────────────────────────────────────────────────────
  ensureSpace(doc, 70);
  const sy = doc.y + 18;
  doc.save().moveTo(PAGE.margin, sy + 22).lineTo(PAGE.margin + 220, sy + 22).lineWidth(0.6).stroke(C.gray)
    .moveTo(PAGE.w - PAGE.margin - 130, sy + 22).lineTo(PAGE.w - PAGE.margin, sy + 22).stroke(C.gray).restore();
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C.text).text(pdfSafe(report.signerName) || "-", PAGE.margin, sy + 6, { width: 220, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(10).text(fmtDate(report.signedAt ?? h.date), PAGE.w - PAGE.margin - 130, sy + 6, { width: 130, lineBreak: false });
  doc.font("Helvetica").fontSize(8).fillColor(C.muted)
    .text("Checked by", PAGE.margin, sy + 27, { width: 220, lineBreak: false })
    .text("Date", PAGE.w - PAGE.margin - 130, sy + 27, { width: 130, lineBreak: false });

  // ── Footer on every page ──────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // writing in the margin must not spawn a new page
    doc.font("Helvetica").fontSize(8).fillColor(C.gray).text(
      `${pdfSafe(center.name)}  |  ${pdfSafe(h.plate)}  |  Page ${i + 1} of ${range.count}`,
      PAGE.margin, PAGE.h - PAGE.margin - 8, { width: CONTENT_W, align: "center", lineBreak: false },
    );
  }
  doc.end();
  return done;
}

module.exports = { renderChecklistPdf };
