import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
} from "lucide-react";

export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB

export type MediaFile = {
  id: number;
  client_id: number;
  filename: string;
  blob_url: string;
  blob_pathname: string;
  content_type: string | null;
  size_bytes: number;
  description: string | null;
  uploaded_at: string;
};

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

export function getFileIcon(contentType: string | null | undefined): LucideIcon {
  const t = (contentType ?? "").toLowerCase();
  if (t.startsWith("image/")) return FileImage;
  if (t.startsWith("video/")) return FileVideo;
  if (t.startsWith("audio/")) return FileAudio;
  if (t === "application/pdf") return FileText;
  if (
    t === "text/csv" ||
    t === "application/vnd.ms-excel" ||
    t === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return FileSpreadsheet;
  }
  if (
    t === "application/zip" ||
    t === "application/x-zip-compressed" ||
    t === "application/x-rar-compressed" ||
    t === "application/vnd.rar" ||
    t === "application/x-7z-compressed"
  ) {
    return FileArchive;
  }
  return FileIcon;
}

export function sanitizeFilename(name: string): string {
  // Collapse whitespace, strip directory separators and risky chars, allow
  // common filename punctuation.
  const cleaned = name
    .replace(/[\\/]/g, "-")
    .replace(/[^A-Za-z0-9._\-()\s]/g, "")
    .replace(/\s+/g, "_")
    .trim();
  return cleaned.length > 0 ? cleaned : "file";
}
