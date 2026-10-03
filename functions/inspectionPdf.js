/**
 * Inspection report PDF (PDFKit). English only, by decision: PDFKit's built-in
 * Helvetica has no Sinhala/Tamil glyphs, so text goes through pdfSafe (other
 * scripts show as "?"), and no fonts are bundled.
 *
 * renderInspectionPdf is pure of Firebase: the caller passes plain JS values
 * (Dates, not Timestamps) and `loadImage(mediaItem)` — which returns a Buffer
 * or null — so it can be exercised locally with fixtures.
 *
 * Layout: header (logo, workshop, report number, date) → vehicle/customer block
 * → result summary and "needs repair" list → sections with a result mark per
 * item, remarks and photos → observations → recommendations → attachments →
 * disclaimer and signature. Every page carries the report number and page x of y.
 */
const PDFDocument = require("pdfkit");
const { pdfSafe } = require("./shared/inspectionHelpers.mjs");

const PAGE = { w: 595.28, h: 841.89, margin: 40, footer: 28 };
const CONTENT_W = PAGE.w - PAGE.margin * 2;
const C = {
  text: "#1F2937", muted: "#6B7280", line: "#E5E7EB", band: "#F3F4F6",
  accent: "#F97316", green: "#15803D", red: "#B91C1C", gray: "#9CA3AF",
};
const THUMB = { w: 118, h: 88, gap: 10 };

const fmtDate = (d) => d
  ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short", year: "numeric" }).format(d)
  : "";
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const RESULT_LABEL = { meets: "Meets", needs_repair: "Needs repair", na: "N/A" };

function bottom() { return PAGE.h - PAGE.margin - PAGE.footer; }
function ensureSpace(doc, h) { if (doc.y + h > bottom()) doc.addPage(); }
function textH(doc, text, width, font, size) {
  return doc.font(font).fontSize(size).heightOfString(pdfSafe(text), { width });
}

/** Result marks are drawn as vectors: Helvetica has no check/cross glyphs. */
function drawMark(doc, status, x, y) {
  const r = 6.5, cx = x + r, cy = y + r;
  doc.save().lineWidth(1.4);
  if (status === "meets") {
    doc.circle(cx, cy, r).stroke(C.green);
    doc.moveTo(cx - 3, cy + 0.2).lineTo(cx - 0.8, cy + 2.6).lineTo(cx + 3.4, cy - 2.4).stroke(C.green);
  } else if (status === "needs_repair") {
    doc.circle(cx, cy, r).fill(C.red);
    doc.moveTo(cx - 2.6, cy - 2.6).lineTo(cx + 2.6, cy + 2.6).moveTo(cx + 2.6, cy - 2.6).lineTo(cx - 2.6, cy + 2.6).stroke("#FFFFFF");
  } else if (status === "na") {
    doc.circle(cx, cy, r).stroke(C.gray);
    doc.moveTo(cx - 3, cy).lineTo(cx + 3, cy).stroke(C.gray);
  } else {
    doc.circle(cx, cy, r).dash(2, { space: 2 }).stroke(C.gray);
  }
  doc.restore();
}

/** Draws `buf` scaled to fit w x h (centred when `center`), returns the size
 *  actually drawn, or null when PDFKit can't decode it. PDFKit does not advance
 *  doc.y for an image placed at an explicit y, so callers use the returned size. */
function drawImageFit(doc, buf, x, y, w, h, center = true) {
  try {
    const img = doc.openImage(buf);
    const scale = Math.min(w / img.width, h / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    doc.image(img, x + (center ? (w - dw) / 2 : 0), y + (center ? (h - dh) / 2 : 0), { width: dw, height: dh });
    return { w: dw, h: dh };
  } catch { return null; }
}

function placeholderBox(doc, x, y, w, h, text) {
  doc.save().rect(x, y, w, h).fill(C.band).restore();
  doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(text, x, y + h / 2 - 4, { width: w, align: "center", lineBreak: false });
}

/** A grid of thumbnails for one item; returns nothing, advances doc.y. */
async function drawPhotoRow(doc, photos, loadImage, x0) {
  const perRow = Math.max(1, Math.floor((CONTENT_W - (x0 - PAGE.margin) + THUMB.gap) / (THUMB.w + THUMB.gap)));
  for (let i = 0; i < photos.length; i += perRow) {
    ensureSpace(doc, THUMB.h + 8);
    const y = doc.y;
    for (let j = 0; j < Math.min(perRow, photos.length - i); j++) {
      const x = x0 + j * (THUMB.w + THUMB.gap);
      const m = photos[i + j];
      const buf = m.mediaDeleted ? null : await loadImage(m);
      doc.save().rect(x, y, THUMB.w, THUMB.h).lineWidth(0.5).stroke(C.line).restore();
      if (m.mediaDeleted) placeholderBox(doc, x, y, THUMB.w, THUMB.h, "Photo expired");
      else if (!buf || !drawImageFit(doc, buf, x + 1, y + 1, THUMB.w - 2, THUMB.h - 2)) placeholderBox(doc, x, y, THUMB.w, THUMB.h, "Photo unavailable");
    }
    doc.y = y + THUMB.h + 8;
  }
}

function heading(doc, title) {
  ensureSpace(doc, 40);
  const y = doc.y;
  doc.save().rect(PAGE.margin, y, CONTENT_W, 20).fill(C.band).restore();
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(C.text).text(pdfSafe(title), PAGE.margin + 8, y + 5.5, { width: CONTENT_W - 16, lineBreak: false });
  doc.y = y + 26;
}

function paragraph(doc, text, opts = {}) {
  const t = pdfSafe(text).trim();
  if (!t) return;
  ensureSpace(doc, Math.min(60, textH(doc, t, CONTENT_W, "Helvetica", opts.size ?? 10)));
  doc.font("Helvetica").fontSize(opts.size ?? 10).fillColor(opts.color ?? C.text).text(t, PAGE.margin, doc.y, { width: CONTENT_W, lineGap: 2 });
  doc.moveDown(0.8);
}

/**
 * @param {object} args
 * @param {object} args.report   plain report data (Dates for reportDate / finalizedAt)
 * @param {{name: string, phone?: string, logo?: Buffer|null}} args.center
 * @param {(m: object) => Promise<Buffer|null>} args.loadImage
 * @returns {Promise<Buffer>}
 */
async function renderInspectionPdf({ report, center, loadImage }) {
  const doc = new PDFDocument({
    size: "A4", margin: PAGE.margin, bufferPages: true, autoFirstPage: true,
    info: { Title: `Inspection report ${report.reportNumber ?? ""}`.trim(), Author: pdfSafe(center.name), Creator: "PitStopIQ" },
  });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });

  const results = report.results ?? {};
  const media = report.media ?? {};
  const itemsOf = (section) => [
    ...(section.items ?? []).map((i) => ({ id: i.id, label: i.label })),
    ...(report.reportOnlyItems ?? []).filter((e) => e.sectionId === section.id).map((e) => ({ id: e.id, label: e.label })),
  ];
  const all = (report.templateSnapshot ?? []).flatMap((s) => itemsOf(s).map((i) => ({ ...i, section: s.title })));
  const count = (st) => all.filter((i) => results[i.id]?.status === st).length;

  // ── Header ────────────────────────────────────────────────────────────────
  let textX = PAGE.margin;
  if (center.logo && drawImageFit(doc, center.logo, PAGE.margin, PAGE.margin, 52, 52)) textX += 64;
  doc.font("Helvetica-Bold").fontSize(17).fillColor(C.text).text(pdfSafe(center.name), textX, PAGE.margin + 4, { width: 300, lineBreak: false });
  doc.font("Helvetica").fontSize(10).fillColor(C.muted).text(report.type === "diagnostic" ? "Diagnostic Report" : "Vehicle Inspection Report", textX, PAGE.margin + 27, { width: 300, lineBreak: false });
  if (center.phone) doc.fontSize(9).text(pdfSafe(center.phone), textX, PAGE.margin + 41, { width: 300, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C.accent).text(report.reportNumber ?? "DRAFT", PAGE.w - PAGE.margin - 200, PAGE.margin + 6, { width: 200, align: "right", lineBreak: false });
  doc.font("Helvetica").fontSize(9).fillColor(C.muted).text(fmtDate(report.reportDate), PAGE.w - PAGE.margin - 200, PAGE.margin + 24, { width: 200, align: "right", lineBreak: false });
  doc.save().moveTo(PAGE.margin, PAGE.margin + 62).lineTo(PAGE.w - PAGE.margin, PAGE.margin + 62).lineWidth(1).stroke(C.accent).restore();
  doc.y = PAGE.margin + 74;

  // ── Vehicle / customer block ───────────────────────────────────────────────
  const h = report.header ?? {};
  const cells = [
    ["Customer", h.customerName], ["Phone", h.customerPhone],
    ["Vehicle", [h.make, h.model].filter(Boolean).join(" ") || h.vehicleType], ["Plate", h.plateNumber],
    ["Mileage", report.mileage != null ? `${Number(report.mileage).toLocaleString("en-US")} km` : "-"], ["Inspector", report.inspectorName || "-"],
  ];
  const colW = CONTENT_W / 2;
  const top = doc.y;
  cells.forEach(([k, v], i) => {
    const x = PAGE.margin + (i % 2) * colW, y = top + Math.floor(i / 2) * 28;
    doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(k.toUpperCase(), x, y, { width: colW - 10, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(C.text).text(pdfSafe(v) || "-", x, y + 10, { width: colW - 10, lineBreak: false });
  });
  doc.y = top + Math.ceil(cells.length / 2) * 28 + 6;

  // ── Diagnostic title + findings ────────────────────────────────────────────
  if (report.type === "diagnostic") {
    if (report.title) { doc.font("Helvetica-Bold").fontSize(13).fillColor(C.text).text(pdfSafe(report.title), PAGE.margin, doc.y, { width: CONTENT_W }); doc.moveDown(0.5); }
    if (report.findings) { heading(doc, "Findings"); paragraph(doc, report.findings); }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  if (all.length) {
    const repairs = all.filter((i) => results[i.id]?.status === "needs_repair");
    ensureSpace(doc, 40);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(C.green).text(`${count("meets")} meet requirements`, PAGE.margin, doc.y, { continued: true })
      .fillColor(C.muted).text("   |   ", { continued: true })
      .fillColor(repairs.length ? C.red : C.muted).text(`${repairs.length} need repair`, { continued: true })
      .fillColor(C.muted).text(`   |   ${count("na")} not applicable`);
    doc.moveDown(0.6);
    if (repairs.length) {
      heading(doc, "Needs repair");
      for (const r of repairs) {
        ensureSpace(doc, 16);
        drawMark(doc, "needs_repair", PAGE.margin + 4, doc.y);
        doc.font("Helvetica").fontSize(10).fillColor(C.text).text(`${pdfSafe(r.label)}  (${pdfSafe(r.section)})`, PAGE.margin + 24, doc.y + 1, { width: CONTENT_W - 28 });
        doc.y += 5;
      }
      doc.moveDown(0.6);
    }
  }

  // ── Sections ───────────────────────────────────────────────────────────────
  for (const section of report.templateSnapshot ?? []) {
    const items = itemsOf(section);
    if (!items.length) continue;
    heading(doc, section.title);
    for (const item of items) {
      const r = results[item.id] ?? {};
      const labelW = CONTENT_W - 28 - 78;
      const lh = textH(doc, item.label, labelW, "Helvetica", 10);
      const remark = pdfSafe(r.remark).trim();
      const rh = remark ? textH(doc, remark, CONTENT_W - 28, "Helvetica-Oblique", 9) + 3 : 0;
      ensureSpace(doc, Math.max(lh, 14) + rh + 6);
      const y = doc.y;
      drawMark(doc, r.status, PAGE.margin + 4, y);
      doc.font("Helvetica").fontSize(10).fillColor(C.text).text(pdfSafe(item.label), PAGE.margin + 24, y + 1, { width: labelW });
      doc.font("Helvetica-Bold").fontSize(8.5)
        .fillColor(r.status === "needs_repair" ? C.red : r.status === "meets" ? C.green : C.muted)
        .text(RESULT_LABEL[r.status] ?? "Not answered", PAGE.w - PAGE.margin - 78, y + 2, { width: 78, align: "right", lineBreak: false });
      doc.y = y + Math.max(lh, 14) + 2;
      if (remark) { doc.font("Helvetica-Oblique").fontSize(9).fillColor(C.muted).text(remark, PAGE.margin + 24, doc.y, { width: CONTENT_W - 28 }); doc.y += 3; }
      const photos = (r.photoIds ?? []).map((id) => media[id]).filter(Boolean);
      if (photos.length) await drawPhotoRow(doc, photos, loadImage, PAGE.margin + 24);
      doc.y += 3;
      doc.save().moveTo(PAGE.margin, doc.y).lineTo(PAGE.w - PAGE.margin, doc.y).lineWidth(0.4).stroke(C.line).restore();
      doc.y += 5;
    }
    doc.moveDown(0.4);
  }

  // ── Observations / recommendations ─────────────────────────────────────────
  if (String(report.observations ?? "").trim()) { heading(doc, "Observations"); paragraph(doc, report.observations); }
  if (String(report.recommendations ?? "").trim()) { heading(doc, "Recommendations"); paragraph(doc, report.recommendations); }

  // ── Attachments ────────────────────────────────────────────────────────────
  const attachments = (report.attachmentIds ?? []).map((id) => media[id]).filter(Boolean);
  if (attachments.length) {
    heading(doc, "Attachments");
    for (const a of attachments) {
      if (a.mimeType === "application/pdf") {
        ensureSpace(doc, 18);
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor(C.text).text(pdfSafe(a.name), PAGE.margin, doc.y, { continued: true })
          .font("Helvetica").fillColor(C.muted).text(`   PDF, ${fmtSize(a.sizeBytes ?? 0)} - attached to the online report`);
        doc.moveDown(0.5);
        continue;
      }
      const buf = a.mediaDeleted ? null : await loadImage(a);
      ensureSpace(doc, 200);
      doc.font("Helvetica").fontSize(8.5).fillColor(C.muted).text(pdfSafe(a.name), PAGE.margin, doc.y, { width: CONTENT_W });
      const y = doc.y + 2;
      const drawn = a.mediaDeleted || !buf ? null : drawImageFit(doc, buf, PAGE.margin, y, CONTENT_W, Math.min(340, bottom() - y), false);
      if (drawn) doc.y = y + drawn.h + 12;
      else {
        placeholderBox(doc, PAGE.margin, y, CONTENT_W, 60, a.mediaDeleted ? "Image expired" : "Image unavailable");
        doc.y = y + 72;
      }
    }
  }

  // ── Disclaimer + signature ─────────────────────────────────────────────────
  ensureSpace(doc, 120);
  doc.moveDown(0.5);
  if (report.disclaimer) paragraph(doc, report.disclaimer, { size: 8, color: C.muted });
  ensureSpace(doc, 70);
  const sy = doc.y + 18;
  doc.save().moveTo(PAGE.margin, sy + 22).lineTo(PAGE.margin + 220, sy + 22).lineWidth(0.6).stroke(C.gray)
    .moveTo(PAGE.w - PAGE.margin - 130, sy + 22).lineTo(PAGE.w - PAGE.margin, sy + 22).stroke(C.gray).restore();
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C.text).text(pdfSafe(report.signatureName), PAGE.margin, sy + 6, { width: 220, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(10).text(fmtDate(report.finalizedAt ?? report.reportDate), PAGE.w - PAGE.margin - 130, sy + 6, { width: 130, lineBreak: false });
  doc.font("Helvetica").fontSize(8).fillColor(C.muted)
    .text("Signed by", PAGE.margin, sy + 27, { width: 220, lineBreak: false })
    .text("Date", PAGE.w - PAGE.margin - 130, sy + 27, { width: 130, lineBreak: false });

  // ── Footer on every page ───────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // writing in the margin must not spawn a new page
    doc.font("Helvetica").fontSize(8).fillColor(C.gray).text(
      `${report.reportNumber ?? "Draft"}  |  ${pdfSafe(center.name)}  |  Page ${i + 1} of ${range.count}`,
      PAGE.margin, PAGE.h - PAGE.margin - 8, { width: CONTENT_W, align: "center", lineBreak: false },
    );
  }
  doc.end();
  return done;
}

module.exports = { renderInspectionPdf };
