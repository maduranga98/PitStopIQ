// ── Media rules (pure) ───────────────────────────────────────────────────────
// Sizing and validation for photos and attachments, kept free of browser and
// Firebase APIs so it is unit-tested directly (mediaRules.test.ts).
import {
  ATTACHMENT_MIME_TYPES, MAX_ATTACHMENTS_PER_REPORT, MAX_FILE_BYTES,
} from "../../constants/inspectionReports.ts";

/** Scale (w, h) down so the longest side is at most `max`; never scales up. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const ratio = max / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** Output size after `quarterTurns` × 90° clockwise rotation of a (w, h) image. */
export function rotatedSize(width: number, height: number, quarterTurns: number): { width: number; height: number } {
  return Math.abs(quarterTurns) % 2 === 1 ? { width: height, height: width } : { width, height };
}

export type AttachmentCheck = { ok: true } | { ok: false; reason: string };

/** Type, size and count checks for a report-level attachment. */
export function validateAttachment(
  file: { type: string; size: number },
  currentAttachmentCount: number,
): AttachmentCheck {
  if (currentAttachmentCount >= MAX_ATTACHMENTS_PER_REPORT) {
    return { ok: false, reason: `A report can have at most ${MAX_ATTACHMENTS_PER_REPORT} attachments.` };
  }
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: "Only PDF, JPG or PNG files are accepted." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, reason: "File is too large — the limit is 10 MB." };
  }
  return { ok: true };
}

/** Photos from a camera/gallery: any image the browser can decode. */
export function validatePhoto(file: { type: string; size: number }): AttachmentCheck {
  if (!file.type.startsWith("image/")) return { ok: false, reason: "That file isn't an image." };
  // Generous cap on the ORIGINAL: it is resized before upload, but a multi-hundred-MB
  // file would exhaust memory while decoding on a phone.
  if (file.size > MAX_FILE_BYTES * 5) return { ok: false, reason: "That photo is too large to process." };
  return { ok: true };
}

export function extensionForMime(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  return "jpg";
}

/** Random, URL-safe, dot-free id for a media item (used as a Firestore map key). */
export function newMediaId(): string {
  return `m_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
