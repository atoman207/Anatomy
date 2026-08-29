export const AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const AVATAR_MAX_DIMENSION = 256;
export const AVATAR_MAX_DATA_URL_LENGTH = 120_000;

/** Downscales an arbitrary image file to a small square-ish JPEG data URL. */
export async function resizeAvatarToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像を処理できませんでした。");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}
