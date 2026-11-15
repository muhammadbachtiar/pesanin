"use client";

import React, { useState, useRef, useCallback } from "react";
import { Modal } from "antd";
import {
  CloudUploadOutlined,
  LinkOutlined,
  DeleteOutlined,
  SwapOutlined,
  EyeOutlined,
  CheckCircleFilled,
  ExclamationCircleFilled,
  LoadingOutlined,
} from "@ant-design/icons";
import {
  AssetFolder,
  MAX_SOURCE_BYTES,
  UNASSIGNED_SCOPE,
  isManagedAssetUrl,
} from "@/lib/storageConfig";
import {
  compressImageToWebP,
  formatBytes,
  FOLDER_COMPRESSION_PRESETS,
} from "@/lib/imageCompression";

export interface ImageUploadFieldProps {
  /** Nilai URL gambar (otomatis di-inject bila berada di dalam Ant Design <Form.Item>) */
  value?: string | null;
  /** Callback saat URL berubah (otomatis di-inject bila di dalam <Form.Item>) */
  onChange?: (url: string) => void;
  /** ID Tenant pemilik aset, atau "_unassigned" saat membuat tenant baru */
  tenantId?: string | null;
  /** Kategori folder di dalam bucket tenant-assets */
  folder: AssetFolder;
  /** Placeholder untuk mode input link URL */
  placeholder?: string;
  /** Teks bantuan di bawah dropzone */
  helperText?: string;
  /** Ukuran kompak untuk ruang modal yang padat */
  compact?: boolean;
}

interface UploadStats {
  originalSize: number;
  compressedSize: number;
  savingsPercent: number;
  width: number;
  height: number;
}

export default function ImageUploadField({
  value,
  onChange,
  tenantId,
  folder,
  placeholder = "https://contoh.com/gambar.webp",
  helperText,
  compact = false,
}: ImageUploadFieldProps) {
  const currentUrl = (value ?? "").trim();
  const effectiveTenantId = (tenantId ?? "").trim() || UNASSIGNED_SCOPE;

  const [mode, setMode] = useState<"upload" | "url">("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState<"idle" | "compressing" | "uploading">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<UploadStats | null>(null);
  const [imgLoadError, setImgLoadError] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const preset = FOLDER_COMPRESSION_PRESETS[folder];

  const handleFileProcess = useCallback(
    async (rawFile: File) => {
      setErrorMsg(null);
      setImgLoadError(false);

      if (!rawFile.type.startsWith("image/")) {
        setErrorMsg("Format file harus berupa gambar (JPG, PNG, atau WebP).");
        return;
      }

      if (rawFile.size > MAX_SOURCE_BYTES) {
        setErrorMsg(
          `Ukuran file mentah terlalu besar (${formatBytes(rawFile.size)}). Maksimal ${formatBytes(MAX_SOURCE_BYTES)}.`
        );
        return;
      }

      try {
        setStage("compressing");
        const compressed = await compressImageToWebP(rawFile, folder);

        setStage("uploading");
        const formData = new FormData();
        formData.append("file", compressed.file);
        formData.append("tenantId", effectiveTenantId);
        formData.append("folder", folder);
        if (currentUrl && isManagedAssetUrl(currentUrl)) {
          formData.append("replaceUrl", currentUrl);
        }

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Gagal mengunggah gambar ke server.");
        }

        setStats({
          originalSize: compressed.originalSize,
          compressedSize: compressed.compressedSize,
          savingsPercent: compressed.savingsPercent,
          width: compressed.width,
          height: compressed.height,
        });

        onChange?.(data.url);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Terjadi kesalahan saat memproses gambar.";
        setErrorMsg(msg);
      } finally {
        setStage("idle");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [currentUrl, effectiveTenantId, folder, onChange]
  );

  const handleRemove = async () => {
    setErrorMsg(null);
    setStats(null);
    setImgLoadError(false);
    const oldUrl = currentUrl;
    onChange?.("");

    if (oldUrl && isManagedAssetUrl(oldUrl)) {
      try {
        await fetch("/api/upload", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: oldUrl }),
        });
      } catch {
        // Non-blocking cleanup
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (stage !== "idle") return;
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileProcess(f);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (stage !== "idle") return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleFileProcess(file);
          return;
        }
      }
    }
  };

  const isBusy = stage !== "idle";
  const isManaged = isManagedAssetUrl(currentUrl);

  return (
    <div onPaste={handlePaste} style={{ width: "100%" }}>
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileProcess(f);
        }}
      />

      {/* Mode Switcher Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
          gap: 8,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            background: "#f1f5f9",
            padding: 3,
            borderRadius: 9,
            border: "1px solid #e2e8f0",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMode("upload");
              setErrorMsg(null);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 11px",
              borderRadius: 7,
              fontSize: 11.5,
              fontWeight: 700,
              border: "none",
              cursor: "pointer",
              transition: "all 0.15s",
              background: mode === "upload" ? "#ffffff" : "transparent",
              color: mode === "upload" ? "#0f172a" : "#64748b",
              boxShadow: mode === "upload" ? "0 1px 3px rgba(15,23,42,0.08)" : "none",
            }}
          >
            <CloudUploadOutlined style={{ fontSize: 13, color: mode === "upload" ? "#4f46e5" : "#64748b" }} />
            Upload File
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("url");
              setErrorMsg(null);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 11px",
              borderRadius: 7,
              fontSize: 11.5,
              fontWeight: 700,
              border: "none",
              cursor: "pointer",
              transition: "all 0.15s",
              background: mode === "url" ? "#ffffff" : "transparent",
              color: mode === "url" ? "#0f172a" : "#64748b",
              boxShadow: mode === "url" ? "0 1px 3px rgba(15,23,42,0.08)" : "none",
            }}
          >
            <LinkOutlined style={{ fontSize: 12, color: mode === "url" ? "#4f46e5" : "#64748b" }} />
            Link URL
          </button>
        </div>

        <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>
          Auto WebP · Maks {preset.maxWidth}×{preset.maxHeight}px
        </span>
      </div>

      {/* Mode URL Input */}
      {mode === "url" && (
        <div style={{ marginBottom: currentUrl ? 8 : 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "#fff",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: "6px 11px",
              gap: 8,
            }}
          >
            <LinkOutlined style={{ color: "#94a3b8", fontSize: 13 }} />
            <input
              type="url"
              value={currentUrl}
              onChange={(e) => {
                setImgLoadError(false);
                setStats(null);
                onChange?.(e.target.value);
              }}
              placeholder={placeholder}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                fontSize: 13,
                color: "#0f172a",
                background: "transparent",
              }}
            />
            {currentUrl && (
              <button
                type="button"
                onClick={handleRemove}
                style={{
                  border: "none",
                  background: "#fee2e2",
                  color: "#dc2626",
                  borderRadius: 6,
                  padding: "2px 7px",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* Preview Card if Image Exists */}
      {currentUrl ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: compact ? 8 : 10,
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            background: "#f8fafc",
          }}
        >
          {/* Thumbnail */}
          <div
            onClick={() => !imgLoadError && setPreviewOpen(true)}
            style={{
              width: compact ? 54 : 68,
              height: compact ? 54 : 68,
              borderRadius: 10,
              overflow: "hidden",
              flexShrink: 0,
              border: "1px solid #e2e8f0",
              background:
                "repeating-conic-gradient(#f1f5f9 0% 25%, #ffffff 0% 50%) 50% / 12px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: imgLoadError ? "default" : " zoom-in",
              position: "relative",
            }}
          >
            {!imgLoadError ? (
              <img
                src={currentUrl}
                alt="Preview"
                onError={() => setImgLoadError(true)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: folder === "qris" || folder === "logos" ? "contain" : "cover",
                }}
              />
            ) : (
              <ExclamationCircleFilled style={{ fontSize: 20, color: "#f59e0b" }} />
            )}
          </div>

          {/* Info & Actions */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: isManaged ? "#eef2ff" : "#f1f5f9",
                  color: isManaged ? "#4f46e5" : "#475569",
                  border: `1px solid ${isManaged ? "#c7d2fe" : "#cbd5e1"}`,
                }}
              >
                {isManaged ? "☁️ Supabase Storage" : "🌐 Link Eksternal"}
              </span>

              {stats && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "#ecfdf5",
                    color: "#059669",
                    border: "1px solid #a7f3d0",
                  }}
                >
                  <CheckCircleFilled style={{ fontSize: 10 }} />
                  {formatBytes(stats.originalSize)} → {formatBytes(stats.compressedSize)}
                  {stats.savingsPercent > 0 ? ` (-${stats.savingsPercent}%)` : ""}
                </span>
              )}
            </div>

            {imgLoadError ? (
              <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "#d97706", fontWeight: 600 }}>
                URL gambar tidak dapat dimuat. Pastikan link publik valid.
              </p>
            ) : (
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 11,
                  color: "#64748b",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={currentUrl}
              >
                {currentUrl}
              </p>
            )}

            {/* Action Buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              {!imgLoadError && (
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 9px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    color: "#334155",
                    cursor: "pointer",
                  }}
                >
                  <EyeOutlined style={{ fontSize: 11 }} /> Lihat
                </button>
              )}

              <button
                type="button"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 9px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  border: "1px solid #c7d2fe",
                  background: "#eef2ff",
                  color: "#4338ca",
                  cursor: isBusy ? "not-allowed" : "pointer",
                }}
              >
                {isBusy ? <LoadingOutlined style={{ fontSize: 11 }} /> : <SwapOutlined style={{ fontSize: 11 }} />}
                {stage === "compressing"
                  ? "Mengoptimasi..."
                  : stage === "uploading"
                  ? "Mengunggah..."
                  : "Ganti Foto"}
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={handleRemove}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 9px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  border: "1px solid #fecaca",
                  background: "#fef2f2",
                  color: "#dc2626",
                  cursor: isBusy ? "not-allowed" : "pointer",
                }}
              >
                <DeleteOutlined style={{ fontSize: 11 }} /> Hapus
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Dropzone when empty & in upload mode */
        mode === "upload" && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!isBusy) setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={handleDrop}
            onClick={() => !isBusy && fileInputRef.current?.click()}
            style={{
              border: `1.5px dashed ${isDragging ? "#4f46e5" : "#cbd5e1"}`,
              borderRadius: 12,
              background: isDragging ? "#eef2ff" : "#f8fafc",
              padding: compact ? "12px 14px" : "16px 16px",
              textAlign: "center",
              cursor: isBusy ? "wait" : "pointer",
              transition: "all 0.15s",
            }}
          >
            {isBusy ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                <LoadingOutlined style={{ fontSize: 20, color: "#4f46e5" }} />
                <div style={{ textAlign: "left" }}>
                  <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: "#1e293b" }}>
                    {stage === "compressing"
                      ? "Mengoptimasi gambar ke format WebP..."
                      : "Mengunggah ke Supabase Storage..."}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>
                    Mohon tunggu sebentar
                  </p>
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: compact ? "row" : "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: compact ? 10 : 6,
                }}
              >
                <div
                  style={{
                    width: compact ? 32 : 38,
                    height: compact ? 32 : 38,
                    borderRadius: 10,
                    background: "#eef2ff",
                    color: "#4f46e5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <CloudUploadOutlined style={{ fontSize: compact ? 16 : 19 }} />
                </div>
                <div style={{ textAlign: compact ? "left" : "center" }}>
                  <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>
                    Klik pilih gambar, tarik & lepas, atau <span style={{ color: "#4f46e5" }}>Ctrl+V</span>
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#64748b" }}>
                    {helperText ?? "JPG, PNG, WebP (maks 15 MB) — otomatis dikompres ke WebP cepat"}
                  </p>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* Error Message */}
      {errorMsg && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 10px",
            borderRadius: 8,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            fontSize: 11.5,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <ExclamationCircleFilled style={{ color: "#ef4444" }} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Lightbox Modal Preview */}
      <Modal
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        centered
        title={<span style={{ fontWeight: 700, fontSize: 14 }}>Pratinjau Gambar</span>}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            padding: "8px 0",
          }}
        >
          <div
            style={{
              maxHeight: 420,
              width: "100%",
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid #e2e8f0",
              background:
                "repeating-conic-gradient(#f1f5f9 0% 25%, #ffffff 0% 50%) 50% / 16px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 12,
            }}
          >
            <img
              src={currentUrl}
              alt="Full preview"
              style={{
                maxHeight: 390,
                maxWidth: "100%",
                objectFit: "contain",
                borderRadius: 8,
              }}
            />
          </div>
          <a
            href={currentUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: "#4f46e5", fontWeight: 600 }}
          >
            Buka gambar di tab baru ↗
          </a>
        </div>
      </Modal>
    </div>
  );
}

