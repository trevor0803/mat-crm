"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Check,
  CloudUpload,
  Download,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  MAX_FILE_SIZE_BYTES,
  MediaFile,
  formatFileSize,
  getFileIcon,
} from "@/lib/media";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const UPLOADED_DATE_FORMAT = "MMM d, yyyy";

type UploadStatus = "uploading" | "error";

type Upload = {
  id: string;
  filename: string;
  progress: number;
  status: UploadStatus;
  errorMessage?: string;
  file: File;
};

type Props = {
  clientId: number;
};

export function MediaSection({ clientId }: Props) {
  const [files, setFiles] = useState<MediaFile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<MediaFile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/media`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed to load media (${res.status})`);
      const data: MediaFile[] = await res.json();
      setFiles(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load media");
      setFiles([]);
    }
  }, [clientId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  function uploadFile(file: File) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error(`${file.name} is over 500MB. Please pick a smaller file.`);
      return;
    }

    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    setUploads((prev) => [
      ...prev,
      { id, filename: file.name, progress: 0, status: "uploading", file },
    ]);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/clients/${clientId}/media`);

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      setUploads((prev) =>
        prev.map((u) => (u.id === id ? { ...u, progress: pct } : u)),
      );
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let created: MediaFile | null = null;
        try {
          created = JSON.parse(xhr.responseText) as MediaFile;
        } catch {
          created = null;
        }
        setUploads((prev) => prev.filter((u) => u.id !== id));
        if (created) {
          setFiles((prev) => (prev ? [created!, ...prev] : [created!]));
        } else {
          await fetchFiles();
        }
        toast.success(`${file.name} uploaded`);
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // fall through with the default
        }
        setUploads((prev) =>
          prev.map((u) =>
            u.id === id ? { ...u, status: "error", errorMessage: message } : u,
          ),
        );
        toast.error(message);
      }
    };

    xhr.onerror = () => {
      const message = "Network error during upload";
      setUploads((prev) =>
        prev.map((u) =>
          u.id === id ? { ...u, status: "error", errorMessage: message } : u,
        ),
      );
      toast.error(message);
    };

    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  }

  function retryUpload(uploadId: string) {
    const target = uploads.find((u) => u.id === uploadId);
    if (!target) return;
    setUploads((prev) => prev.filter((u) => u.id !== uploadId));
    uploadFile(target.file);
  }

  function dismissUpload(uploadId: string) {
    setUploads((prev) => prev.filter((u) => u.id !== uploadId));
  }

  function handleSelect(list: FileList | null) {
    if (!list) return;
    Array.from(list).forEach(uploadFile);
  }

  function openPicker() {
    fileInputRef.current?.click();
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  }
  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    handleSelect(e.dataTransfer.files);
  }

  function startEdit(file: MediaFile) {
    setEditingId(file.id);
    setEditDraft(file.description ?? "");
  }
  function cancelEdit() {
    setEditingId(null);
    setEditDraft("");
  }

  async function saveEdit(file: MediaFile) {
    const next = editDraft.trim();
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/media/${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: next === "" ? null : next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Update failed (${res.status})`);
      }
      const updated: MediaFile = await res.json();
      setFiles((prev) =>
        prev ? prev.map((f) => (f.id === updated.id ? updated : f)) : prev,
      );
      cancelEdit();
      toast.success("Description updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingEdit(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const name = deleteTarget.filename;
    setDeleting(true);
    try {
      const res = await fetch(`/api/media/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      setFiles((prev) =>
        prev ? prev.filter((f) => f.id !== deleteTarget.id) : prev,
      );
      setDeleteTarget(null);
      toast.success(`${name} deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  const fileCount = files?.length ?? 0;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-brand-gold">
          Media
          {files !== null && (
            <span className="text-sm font-normal text-gray-400">
              ({fileCount})
            </span>
          )}
        </h2>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleSelect(e.target.files);
          // Reset so picking the same file again triggers onChange.
          e.target.value = "";
        }}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`flex h-[120px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed transition-colors ${
          dragOver
            ? "border-brand-gold bg-brand-gold/10"
            : "border-brand-gold/40 bg-brand-card/40 hover:border-brand-gold/70 hover:bg-brand-card/60"
        }`}
      >
        <CloudUpload className="h-7 w-7 text-brand-gold" />
        <p className="text-sm text-gray-200">
          Drag files here, or{" "}
          <span className="text-brand-gold underline">click to browse</span>
        </p>
        <p className="text-xs text-gray-500">Max 500MB per file</p>
      </div>

      {uploads.length > 0 && (
        <div className="mt-3 space-y-2">
          {uploads.map((u) => (
            <UploadCard
              key={u.id}
              upload={u}
              onRetry={() => retryUpload(u.id)}
              onDismiss={() => dismissUpload(u.id)}
            />
          ))}
        </div>
      )}

      {loadError && (
        <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {loadError}
        </div>
      )}

      <div className="mt-4">
        <FileGrid
          files={files}
          editingId={editingId}
          editDraft={editDraft}
          savingEdit={savingEdit}
          onEditDraftChange={setEditDraft}
          onStartEdit={startEdit}
          onCancelEdit={cancelEdit}
          onSaveEdit={saveEdit}
          onDelete={(f) => setDeleteTarget(f)}
        />
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete File"
        message={
          deleteTarget && (
            <>
              Delete{" "}
              <span className="font-medium text-gray-100">
                {deleteTarget.filename}
              </span>
              ? This can&apos;t be undone.
            </>
          )
        }
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => (deleting ? undefined : setDeleteTarget(null))}
      />
    </section>
  );
}

function UploadCard({
  upload,
  onRetry,
  onDismiss,
}: {
  upload: Upload;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const isError = upload.status === "error";
  return (
    <div className="rounded-md border border-white/10 bg-brand-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-100">
            {upload.filename}
          </div>
          {isError ? (
            <div className="mt-1 text-xs text-red-300">
              {upload.errorMessage ?? "Upload failed"}
            </div>
          ) : (
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-brand-gold transition-[width] duration-150"
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {upload.progress}%
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isError && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-white/10 px-2 py-1 text-xs text-gray-200 hover:bg-white/5"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function FileGrid({
  files,
  editingId,
  editDraft,
  savingEdit,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  files: MediaFile[] | null;
  editingId: number | null;
  editDraft: string;
  savingEdit: boolean;
  onEditDraftChange: (v: string) => void;
  onStartEdit: (f: MediaFile) => void;
  onCancelEdit: () => void;
  onSaveEdit: (f: MediaFile) => void;
  onDelete: (f: MediaFile) => void;
}) {
  if (files === null) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-lg bg-brand-card/60"
          />
        ))}
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="rounded-lg border border-white/5 bg-brand-card p-5 text-sm text-gray-500">
        No files yet. Drag and drop or click above to upload.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {files.map((f) => (
        <FileCard
          key={f.id}
          file={f}
          isEditing={editingId === f.id}
          editDraft={editDraft}
          savingEdit={savingEdit}
          onEditDraftChange={onEditDraftChange}
          onStartEdit={() => onStartEdit(f)}
          onCancelEdit={onCancelEdit}
          onSaveEdit={() => onSaveEdit(f)}
          onDelete={() => onDelete(f)}
        />
      ))}
    </div>
  );
}

function FileCard({
  file,
  isEditing,
  editDraft,
  savingEdit,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  file: MediaFile;
  isEditing: boolean;
  editDraft: string;
  savingEdit: boolean;
  onEditDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = useMemo(() => getFileIcon(file.content_type), [file.content_type]);

  return (
    <div className="group relative flex gap-3 rounded-lg border border-white/5 bg-brand-card p-4">
      <div className="shrink-0">
        <Icon className="h-9 w-9 text-brand-gold" />
      </div>

      <div className="min-w-0 flex-1">
        <div
          className="truncate text-sm font-semibold text-gray-100"
          title={file.filename}
        >
          {file.filename}
        </div>
        <div className="mt-0.5 text-xs text-gray-400">
          {formatFileSize(file.size_bytes)} ·{" "}
          {format(new Date(file.uploaded_at), UPLOADED_DATE_FORMAT)}
        </div>

        {isEditing ? (
          <div className="mt-2 space-y-2">
            <textarea
              value={editDraft}
              onChange={(e) => onEditDraftChange(e.target.value)}
              rows={2}
              placeholder="Description"
              className="w-full resize-y rounded-md border border-white/10 bg-brand-navy px-2 py-1.5 text-xs text-gray-100 placeholder:text-gray-500 focus:border-brand-gold focus:outline-none focus:ring-1 focus:ring-brand-gold"
            />
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={onCancelEdit}
                disabled={savingEdit}
                aria-label="Cancel"
                className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onSaveEdit}
                disabled={savingEdit}
                aria-label="Save description"
                className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-brand-gold disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          file.description && (
            <div className="mt-1 break-words text-xs italic text-gray-400">
              {file.description}
            </div>
          )
        )}
      </div>

      {!isEditing && (
        <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <a
            href={file.blob_url}
            download={file.filename}
            target="_blank"
            rel="noreferrer"
            aria-label={`Download ${file.filename}`}
            className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-brand-gold"
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={onStartEdit}
            aria-label={`Edit description for ${file.filename}`}
            className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-brand-gold"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${file.filename}`}
            className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
