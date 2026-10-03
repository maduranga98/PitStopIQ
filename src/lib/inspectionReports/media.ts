// ── Photo pipeline (browser) ─────────────────────────────────────────────────
// Phone photos arrive sideways (EXIF orientation), at 12 MP+, in HEIC on some
// devices. Before anything is stored: decode with the orientation applied,
// optionally rotate by the inspector's choice, scale so the longest side is at
// most PHOTO_MAX_DIMENSION_PX, and encode as JPEG at PHOTO_JPEG_QUALITY.
//
// Deliberately NOT lib/imageCompressor.ts: that one belongs to the job-card
// inspection (different limits, no rotate) and must not change.
import { PHOTO_JPEG_QUALITY, PHOTO_MAX_DIMENSION_PX } from "../../constants/inspectionReports";
import { fitWithin, rotatedSize } from "./mediaRules";

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Decode with EXIF orientation applied. createImageBitmap first; an <img>
 *  element (which browsers orient by default) when the option isn't supported. */
async function decode(file: Blob): Promise<Decoded> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
}

async function toJpeg(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/jpeg", quality: PHOTO_JPEG_QUALITY });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), "image/jpeg", PHOTO_JPEG_QUALITY));
}

/**
 * @param quarterTurns clockwise 90° turns to apply after the EXIF fix (the
 *        inspector's manual rotate). Any integer; reduced mod 4.
 */
export async function processPhoto(file: Blob, quarterTurns = 0): Promise<Blob> {
  const img = await decode(file);
  try {
    const turns = ((quarterTurns % 4) + 4) % 4;
    const rotated = rotatedSize(img.width, img.height, turns);
    const out = fitWithin(rotated.width, rotated.height, PHOTO_MAX_DIMENSION_PX);
    const canvas = makeCanvas(out.width, out.height);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("Canvas context unavailable");
    // White behind transparent PNGs, which JPEG would otherwise render black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((turns * Math.PI) / 2);
    // Draw the UNROTATED image scaled by the same factor, centred on the origin.
    const scale = out.width / rotated.width;
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img.source, -dw / 2, -dh / 2, dw, dh);
    return await toJpeg(canvas);
  } finally {
    img.close();
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
