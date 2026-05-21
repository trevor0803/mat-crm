"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Client } from "@/lib/clients";
import { Note } from "@/lib/notes";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { NotesFeed } from "@/components/NotesFeed";

export default function ChatterPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [composeText, setComposeText] = useState("");
  const [posting, setPosting] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  const [deleteNoteTarget, setDeleteNoteTarget] = useState<Note | null>(null);
  const [deletingNote, setDeletingNote] = useState(false);

  async function fetchClients() {
    const res = await fetch("/api/clients", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load clients (${res.status})`);
    const data: Client[] = await res.json();
    setClients(data);
  }

  async function fetchNotes() {
    const res = await fetch("/api/notes", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load notes (${res.status})`);
    const data: Note[] = await res.json();
    setNotes(data);
  }

  useEffect(() => {
    Promise.all([fetchClients(), fetchNotes()]).catch((err) => {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    });
  }, []);

  const sortedClients = useMemo(
    () =>
      [...clients].sort((a, b) =>
        a.business_name.localeCompare(b.business_name, undefined, { sensitivity: "base" }),
      ),
    [clients],
  );

  const canPost =
    selectedClientId !== "" && composeText.trim() !== "" && !posting;

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    if (!canPost) return;
    setComposeError(null);
    setPosting(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: Number(selectedClientId),
          note: composeText.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Post failed (${res.status})`);
      }
      const created: Note = await res.json();
      setNotes((prev) => (prev ? [created, ...prev] : [created]));
      setComposeText("");
      setSelectedClientId("");
      toast.success("Note posted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to post note";
      setComposeError(message);
      toast.error(message);
    } finally {
      setPosting(false);
    }
  }

  async function updateNote(target: Note, nextText: string) {
    try {
      const res = await fetch(`/api/notes/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: nextText }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Update failed (${res.status})`);
      }
      const updated: Note = await res.json();
      setNotes((prev) =>
        prev ? prev.map((n) => (n.id === updated.id ? updated : n)) : prev,
      );
      toast.success("Note updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update note");
    }
  }

  async function confirmDeleteNote() {
    if (!deleteNoteTarget) return;
    const target = deleteNoteTarget;
    setDeletingNote(true);
    setNotes((prev) => (prev ? prev.filter((n) => n.id !== target.id) : prev));
    try {
      const res = await fetch(`/api/notes/${target.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      setDeleteNoteTarget(null);
      toast.success("Note deleted");
    } catch (err) {
      // Rollback the optimistic removal.
      setNotes((prev) => {
        if (!prev) return prev;
        if (prev.some((n) => n.id === target.id)) return prev;
        const next = [...prev, target];
        next.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        return next;
      });
      toast.error(err instanceof Error ? err.message : "Failed to delete note");
    } finally {
      setDeletingNote(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-3 text-2xl font-semibold text-brand-gold">Post Chatter Note</h1>
        <form
          onSubmit={handlePost}
          className="space-y-3 rounded-lg border border-white/5 bg-brand-card p-4"
        >
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-brand-navy px-3 py-2 text-sm text-gray-100 focus:border-brand-gold focus:outline-none focus:ring-1 focus:ring-brand-gold"
            aria-label="Client"
          >
            <option value="">Select a business...</option>
            {sortedClients.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.business_name}
              </option>
            ))}
          </select>

          <textarea
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            placeholder="Write a note..."
            rows={4}
            className="w-full resize-y rounded-md border border-white/10 bg-brand-navy px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-brand-gold focus:outline-none focus:ring-1 focus:ring-brand-gold"
          />

          {composeError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {composeError}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!canPost}
              className="rounded-md bg-brand-gold px-4 py-1.5 text-sm font-semibold text-brand-navy hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {posting ? "Posting..." : "Post"}
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-brand-gold">Recent Notes</h2>
        {loadError && (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {loadError}
          </div>
        )}
        <NotesFeed
          notes={notes}
          showBusinessName
          emptyMessage="No chatter notes yet."
          onDelete={(n) => setDeleteNoteTarget(n)}
          onUpdate={updateNote}
        />
      </section>

      <ConfirmDialog
        open={!!deleteNoteTarget}
        title="Delete this note?"
        message="This can't be undone."
        busy={deletingNote}
        onConfirm={confirmDeleteNote}
        onCancel={() => (deletingNote ? undefined : setDeleteNoteTarget(null))}
      />
    </div>
  );
}
