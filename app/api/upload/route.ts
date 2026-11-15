import { NextResponse } from "next/server";
import { createSupabaseAdminClient, getServerProfile } from "@/lib/serverAuth";
import {
  ASSET_BUCKET,
  ASSET_FOLDERS,
  ALLOWED_UPLOAD_MIME,
  MAX_UPLOAD_BYTES,
  UNASSIGNED_SCOPE,
  getAssetPathFromUrl,
  type AssetFolder,
} from "@/lib/storageConfig";
import { removeAssetsByUrl } from "@/lib/storage";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function detectImageMime(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes.length < 12) return null;

  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }

  return null;
}

export async function POST(req: Request) {
  const profile = await getServerProfile();
  if (!profile) {
    return NextResponse.json({ error: "Sesi berakhir, silakan login kembali." }, { status: 401 });
  }
  if (profile.role !== "SUPER_ADMIN" && profile.role !== "OWNER") {
    return NextResponse.json(
      { error: "Hanya Super Admin atau Owner yang memiliki akses upload aset." },
      { status: 403 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Format request harus multipart/form-data." }, { status: 400 });
  }

  const file = formData.get("file");
  const rawTenantId = String(formData.get("tenantId") ?? "").trim();
  const rawFolder = String(formData.get("folder") ?? "").trim() as AssetFolder;
  const replaceUrl = String(formData.get("replaceUrl") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File gambar tidak ditemukan." }, { status: 400 });
  }

  if (!ASSET_FOLDERS.includes(rawFolder)) {
    return NextResponse.json({ error: "Kategori folder aset tidak valid." }, { status: 400 });
  }

  // Validasi scope tenant
  let scope = rawTenantId;
  if (profile.role === "OWNER") {
    if (!profile.tenant_id || rawTenantId !== profile.tenant_id) {
      return NextResponse.json({ error: "Akses ditolak untuk tenant ini." }, { status: 403 });
    }
    scope = profile.tenant_id;
  } else {
    // SUPER_ADMIN boleh ke UUID tenant mana saja atau _unassigned (saat buat tenant baru)
    if (rawTenantId !== UNASSIGNED_SCOPE && !UUID_REGEX.test(rawTenantId)) {
      return NextResponse.json({ error: "ID Tenant tidak valid." }, { status: 400 });
    }
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: "File gambar kosong." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Ukuran file melebihi batas maksimum 2 MB setelah kompresi." },
      { status: 413 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const detected = detectImageMime(bytes);

  if (!detected || !(ALLOWED_UPLOAD_MIME as readonly string[]).includes(detected.mime)) {
    return NextResponse.json(
      { error: "Format file tidak didukung. Gunakan gambar WebP, JPG, atau PNG." },
      { status: 415 }
    );
  }

  const randomSuffix = Math.random().toString(36).slice(2, 9);
  const objectPath = `${scope}/${rawFolder}/${Date.now()}-${randomSuffix}.${detected.ext}`;

  const sb = createSupabaseAdminClient();

  let { error: upErr } = await sb.storage.from(ASSET_BUCKET).upload(objectPath, bytes, {
    contentType: detected.mime,
    cacheControl: "31536000",
    upsert: false,
  });

  // Self-healing: jika bucket belum dibuat di Supabase, otomatis provision bucket lalu retry sekali
  if (upErr && /bucket.*not found/i.test(upErr.message)) {
    await sb.storage.createBucket(ASSET_BUCKET, {
      public: true,
      fileSizeLimit: MAX_UPLOAD_BYTES,
      allowedMimeTypes: [...ALLOWED_UPLOAD_MIME],
    });
    const retry = await sb.storage.from(ASSET_BUCKET).upload(objectPath, bytes, {
      contentType: detected.mime,
      cacheControl: "31536000",
      upsert: false,
    });
    upErr = retry.error;
  }

  if (upErr) {
    return NextResponse.json(
      { error: `Gagal mengunggah ke Supabase Storage: ${upErr.message}` },
      { status: 500 }
    );
  }

  // Bersihkan file lama bila mengganti gambar di scope yang sama
  if (replaceUrl) {
    const oldPath = getAssetPathFromUrl(replaceUrl);
    if (
      oldPath &&
      (oldPath.startsWith(`${scope}/`) ||
        (profile.role === "SUPER_ADMIN" && oldPath.startsWith(`${UNASSIGNED_SCOPE}/`)))
    ) {
      await removeAssetsByUrl([replaceUrl]);
    }
  }

  const { data: pub } = sb.storage.from(ASSET_BUCKET).getPublicUrl(objectPath);

  return NextResponse.json({
    url: pub.publicUrl,
    path: objectPath,
    size: bytes.byteLength,
    mime: detected.mime,
  });
}

export async function DELETE(req: Request) {
  const profile = await getServerProfile();
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (profile.role !== "SUPER_ADMIN" && profile.role !== "OWNER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }

  const path = getAssetPathFromUrl(body.url);
  if (!path) {
    // Jika bukan aset dari bucket kita (misal link eksternal), anggap sukses tanpa menyentuh storage
    return NextResponse.json({ ok: true, external: true });
  }

  if (profile.role === "OWNER") {
    if (!profile.tenant_id || !path.startsWith(`${profile.tenant_id}/`)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  await removeAssetsByUrl([body.url]);
  return NextResponse.json({ ok: true });
}

