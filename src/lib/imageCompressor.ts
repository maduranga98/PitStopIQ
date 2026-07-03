const MAX_BYTES = 800 * 1024;
const MAX_DIMENSION = 1920;

export async function compressImage(
  file: File,
  targetBytes: number = MAX_BYTES,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  let width = bitmap.width;
  let height = bitmap.height;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let quality = 0.85;
  let blob = await canvas.convertToBlob({ type: "image/jpeg", quality });

  while (blob.size > targetBytes && quality > 0.3) {
    quality -= 0.1;
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  }

  return blob;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
