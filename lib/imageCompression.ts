import { AssetFolder, MAX_UPLOAD_BYTES } from "./storageConfig";

export interface CompressionPreset {
  maxWidth: number;
  maxHeight: number;
  quality: number;
}

export const FOLDER_COMPRESSION_PRESETS: Record<AssetFolder, CompressionPreset> = {
  logos: { maxWidth: 512, maxHeight: 512, quality: 0.86 },
  products: { maxWidth: 960, maxHeight: 960, quality: 0.82 },
  categories: { maxWidth: 512, maxHeight: 512, quality: 0.84 },
  qris: { maxWidth: 1080, maxHeight: 1080, quality: 0.92 }, // QRIS butuh ketajaman tinggi agar mudah di-scan
};

export interface CompressedImageResult {
  file: File;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
  savingsPercent: number;
  mimeType: string;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Gagal membaca file gambar. Pastikan file tidak rusak."));
    };
    img.src = objectUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/**
 * Kompres & resize gambar di sisi browser menjadi WebP (fallback JPEG/PNG bila browser tidak dukung encode WebP).
 * Menurunkan kualitas secara bertahap bila ukuran masih di atas MAX_UPLOAD_BYTES.
 */
export async function compressImageToWebP(
  sourceFile: File,
  folder: AssetFolder = "products",
  customPreset?: Partial<CompressionPreset>
): Promise<CompressedImageResult> {
  const preset = { ...FOLDER_COMPRESSION_PRESETS[folder], ...customPreset };
  const img = await loadImageFromFile(sourceFile);

  const srcW = img.naturalWidth || img.width || 1;
  const srcH = img.naturalHeight || img.height || 1;

  // Hitung dimensi proporsional tanpa upscale
  const scale = Math.min(1, preset.maxWidth / srcW, preset.maxHeight / srcH);
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Browser tidak mendukung pemrosesan Canvas 2D.");
  }

  // Untuk QRIS pastikan background putih bersih bila gambar sumber PNG transparan
  if (folder === "qris") {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, targetW, targetH);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, targetW, targetH);

  let quality = preset.quality;
  let mimeType = "image/webp";
  let blob = await canvasToBlob(canvas, mimeType, quality);

  // Fallback ke JPEG bila browser tidak bisa encode WebP
  if (!blob || blob.type !== "image/webp") {
    mimeType = "image/jpeg";
    blob = await canvasToBlob(canvas, mimeType, quality);
  }

  // Jika masih melebihi batas upload 2 MB, turunkan kualitas bertahap
  while (blob && blob.size > MAX_UPLOAD_BYTES && quality > 0.45) {
    quality = Math.max(0.4, quality - 0.12);
    blob = await canvasToBlob(canvas, mimeType, quality);
  }

  if (!blob) {
    throw new Error("Gagal mengonversi gambar.");
  }

  const ext = mimeType === "image/webp" ? "webp" : "jpg";
  const baseName = sourceFile.name.replace(/\.[^/.]+$/, "") || "image";
  const compressedFile = new File([blob], `${baseName}.${ext}`, {
    type: mimeType,
    lastModified: Date.now(),
  });

  const originalSize = sourceFile.size;
  const compressedSize = compressedFile.size;
  const savingsPercent =
    originalSize > 0
      ? Math.max(0, Math.round(((originalSize - compressedSize) / originalSize) * 100))
      : 0;

  return {
    file: compressedFile,
    width: targetW,
    height: targetH,
    originalSize,
    compressedSize,
    savingsPercent,
    mimeType,
  };
}

