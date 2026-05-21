"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Note } from "@/lib/notes";

const NOTE_TIMESTAMP_FORMAT = "MMM d, yyyy 'at' h:mm a";

type Props = {
  notes: Note[] | null;
  showBusinessName: boolean;
  emptyMessage?: string;
  className?: string;
  onDelete?: (note: Note) => void;
  onUpdate?: (note: Note, nextText: string) => Promise<void> | void;
};

export function NotesFeed({
  notes,
  showBusinessName,
  emptyMessage,
  className = "",
  onDelete,
  onUpdate,
}: Props) {
  if (notes === null) {
    return (
      <div className={`space-y-3 ${className}`}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg bg-brand-card/60"
          />
        ))}
      </div>
    );
  }
  if (notes.length === 0) {
    const fallback = showBusinessName
      ? "No chatter notes yet."
      : "No notes yet. Post the first one.";
    return (
      <div
        className={`rounded-lg border border-white/5 bg-brand-card p-5 text-sm text-gray-500 ${className}`}
      >
        {emptyMessage ?? fallback}
      </div>
    );
  }
  return (
    <div className={`space-y-3 ${className}`}>
      {notes.map((n) => (
        <NoteCard
          key={n.id}
          note={n}
          showBusinessName={showBusinessName}
          onDelete={onDelete}
          onUpdate={onUpdate}
        />
      ))}
    </div>
  );
}

function NoteCard({
  note,
  showBusinessName,
  onDelete,
  onUpdate,
}: {
  note: Note;
  showBusinessName: boolean;
  onDelete?: (note: Note) => void;
  onUpdate?: (note: Note, nextText: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.note);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(note.note);
  }, [note.note, editing]);

  const hasActions = !!onDelete || !!onUpdate;
  const reservePad = hasActions && !editing ? "pr-16" : "";

  async function save() {
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === note.note || !onUpdate) {
      setEditing(false);
      setDraft(note.note);
      return;
    }
    setSaving(true);
    try {
      await onUpdate(note, trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(note.note);
    setEditing(false);
  }

  return (
    <article className="group relative rounded-lg border border-white/5 bg-brand-card p-4">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {showBusinessName ? (
          <Link
            href={`/clients/${note.client_id}`}
            className="text-sm font-semibold text-brand-gold hover:underline"
          >
            {note.business_name}
          </Link>
        ) : (
          <span />
        )}
        <time
          dateTime={note.created_at}
          className={`text-xs text-gray-500 ${reservePad}`}
          title={note.created_at}
        >
          {format(new Date(note.created_at), NOTE_TIMESTAMP_FORMAT)}
        </time>
      </header>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
            className="w-full resize-y rounded-md border border-white/10 bg-brand-navy px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-brand-gold focus:outline-none focus:ring-1 focus:ring-brand-gold"
          />
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              aria-label="Cancel edit"
              className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-gray-100 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || draft.trim() === ""}
              aria-label="Save edit"
              className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-brand-gold disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-gray-200">{note.note}</p>
      )}

      {hasActions && !editing && (
        <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {onUpdate && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit note"
              className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-brand-gold"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(note)}
              aria-label="Delete note"
              className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}
