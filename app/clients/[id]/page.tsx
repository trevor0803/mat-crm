"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { Client, formatCurrency } from "@/lib/clients";
import { Note } from "@/lib/notes";
import { Task, TeamMember } from "@/lib/tasks";
import { ClientFormModal } from "@/components/ClientFormModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MediaSection } from "@/components/MediaSection";
import { NotesFeed } from "@/components/NotesFeed";
import { TaskFormModal } from "@/components/TaskFormModal";
import { TaskList } from "@/components/TaskList";

const MEMBER_SINCE_FORMAT = "MMM yyyy";

export default function ClientDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;

  const [client, setClient] = useState<Client | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<Task | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const [composeText, setComposeText] = useState("");
  const [posting, setPosting] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  async function fetchClient() {
    const res = await fetch(`/api/clients/${id}`, { cache: "no-store" });
    if (res.status === 404) {
      setNotFound(true);
      return null;
    }
    if (!res.ok) throw new Error(`Failed to load client (${res.status})`);
    const data: Client = await res.json();
    setClient(data);
    return data;
  }

  async function fetchNotes() {
    const res = await fetch(`/api/notes?client_id=${id}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load notes (${res.status})`);
    const data: Note[] = await res.json();
    setNotes(data);
  }

  async function fetchTasks() {
    const res = await fetch(`/api/tasks?client_id=${id}&status=all`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Failed to load tasks (${res.status})`);
    const data: Task[] = await res.json();
    setTasks(data);
  }

  async function fetchTeam() {
    try {
      const res = await fetch("/api/team", { cache: "no-store" });
      if (!res.ok) return;
      setTeam(await res.json());
    } catch {
      // non-fatal — task modal can still open without assignees populated
    }
  }

  useEffect(() => {
    if (!validId) {
      setNotFound(true);
      return;
    }
    Promise.all([fetchClient(), fetchNotes(), fetchTasks(), fetchTeam()]).catch(
      (err) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load");
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Pending first, then done. Within each bucket, preserve API order
  // (which sorts pending by due/priority and done by completed_at desc).
  const sortedTasks = useMemo(() => {
    if (!tasks) return [];
    const pending = tasks.filter((t) => t.status === "pending");
    const done = tasks.filter((t) => t.status === "done");
    return [...pending, ...done];
  }, [tasks]);

  async function handleDeleteClient() {
    if (!client) return;
    const name = client.business_name;
    setDeleting(true);
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      toast.success(`Deleted ${name}`);
      router.push("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      setLoadError(message);
      toast.error(message);
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  async function toggleTaskStatus(t: Task) {
    const next = t.status === "done" ? "pending" : "done";
    setTasks((prev) =>
      prev ? prev.map((row) => (row.id === t.id ? { ...row, status: next } : row)) : prev,
    );
    try {
      const res = await fetch(`/api/tasks/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Update failed (${res.status})`);
      }
      await fetchTasks();
      toast.success(next === "done" ? "Task marked done" : "Task reopened");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update task";
      setTasksError(message);
      toast.error(message);
      await fetchTasks();
    }
  }

  function openTaskCreate() {
    setEditingTask(null);
    setTaskModalOpen(true);
  }
  function openTaskEdit(t: Task) {
    setEditingTask(t);
    setTaskModalOpen(true);
  }
  function closeTaskModal() {
    setTaskModalOpen(false);
    setEditingTask(null);
  }

  async function confirmDeleteTask() {
    if (!deleteTaskTarget) return;
    setDeletingTask(true);
    try {
      const res = await fetch(`/api/tasks/${deleteTaskTarget.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      setDeleteTaskTarget(null);
      await fetchTasks();
      toast.success("Task deleted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      setTasksError(message);
      toast.error(message);
    } finally {
      setDeletingTask(false);
    }
  }

  async function postNote(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    const trimmed = composeText.trim();
    if (!trimmed) return;
    setComposeError(null);
    setPosting(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: client.id, note: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Post failed (${res.status})`);
      }
      const created: Note = await res.json();
      setNotes((prev) => (prev ? [created, ...prev] : [created]));
      setComposeText("");
      toast.success("Note posted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to post note";
      setComposeError(message);
      toast.error(message);
    } finally {
      setPosting(false);
    }
  }

  if (notFound) {
    return (
      <div className="space-y-6">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-brand-gold">
          <ArrowLeft className="h-4 w-4" /> All Clients
        </Link>
        <div className="rounded-lg border border-white/5 bg-brand-card p-8 text-center">
          <h2 className="text-xl font-semibold text-gray-100">Client not found</h2>
          <p className="mt-2 text-sm text-gray-400">
            The client you&apos;re looking for doesn&apos;t exist or has been deleted.
          </p>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="space-y-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-brand-gold"
        >
          <ArrowLeft className="h-4 w-4" /> All Clients
        </Link>
        <div className="h-9 w-72 animate-pulse rounded bg-brand-card/60" />

        <div className="rounded-lg border border-white/5 bg-brand-card p-6">
          <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-24 animate-pulse rounded bg-white/5" />
                <div className="h-4 w-40 animate-pulse rounded bg-white/5" />
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-3 h-5 w-32 animate-pulse rounded bg-brand-card/60" />
          <div className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/5 bg-brand-card">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-4 px-4 py-3">
                <div className="h-4 flex-1 animate-pulse rounded bg-white/5" />
                <div className="h-4 flex-1 animate-pulse rounded bg-white/5" />
                <div className="h-4 flex-1 animate-pulse rounded bg-white/5" />
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-3 h-5 w-24 animate-pulse rounded bg-brand-card/60" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg bg-brand-card/60"
              />
            ))}
          </div>
        </div>

        {loadError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {loadError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-brand-gold"
      >
        <ArrowLeft className="h-4 w-4" /> All Clients
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-3xl font-semibold text-brand-gold">{client.business_name}</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            aria-label="Edit client"
            className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-brand-gold"
          >
            <Pencil className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            aria-label="Delete client"
            className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-red-400"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {loadError}
        </div>
      )}

      <section className="rounded-lg border border-white/5 bg-brand-card p-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
          <InfoRow label="Retainer">{formatCurrency(client.retainer)}</InfoRow>
          <InfoRow label="Bill Date">{client.bill_date ?? <Dash />}</InfoRow>
          <InfoRow label="Ad Spend Dates">{client.ad_spend_dates ?? <Dash />}</InfoRow>
          <InfoRow label="Billing Method">{client.billing_method ?? <Dash />}</InfoRow>
          <InfoRow label="GHL">
            {client.uses_ghl ? (
              <span className="inline-flex items-center rounded-full bg-brand-gold/15 px-2 py-0.5 text-xs font-semibold text-brand-gold">
                GHL
              </span>
            ) : (
              <Dash />
            )}
          </InfoRow>
          <InfoRow label="Status">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  client.active ? "bg-green-500" : "bg-red-500"
                }`}
              />
              {client.active ? "Active" : "Inactive"}
            </span>
          </InfoRow>
          <InfoRow label="Member Since">
            {format(new Date(client.created_at), MEMBER_SINCE_FORMAT)}
          </InfoRow>
        </dl>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-brand-gold">
            Tasks
            {tasks !== null && (
              <span className="text-sm font-normal text-gray-400">({tasks.length})</span>
            )}
          </h2>
          <button
            type="button"
            onClick={openTaskCreate}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-gold px-3 py-1.5 text-sm font-semibold text-brand-navy hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            New Task
          </button>
        </div>

        {tasksError && (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {tasksError}
          </div>
        )}

        <TaskList
          tasks={sortedTasks}
          loading={tasks === null}
          emptyMessage="No tasks for this client yet."
          hideClientLink
          onToggle={toggleTaskStatus}
          onEdit={openTaskEdit}
          onDelete={(t) => setDeleteTaskTarget(t)}
        />
      </section>

      <MediaSection clientId={client.id} />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-brand-gold">Chatter</h2>

        <form
          onSubmit={postNote}
          className="rounded-lg border border-white/5 bg-brand-card p-4"
        >
          <textarea
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            placeholder={`Post an update about ${client.business_name}...`}
            rows={3}
            className="w-full resize-y rounded-md border border-white/10 bg-brand-navy px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-brand-gold focus:outline-none focus:ring-1 focus:ring-brand-gold"
          />
          {composeError && (
            <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {composeError}
            </div>
          )}
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              disabled={posting || composeText.trim() === ""}
              className="rounded-md bg-brand-gold px-4 py-1.5 text-sm font-semibold text-brand-navy hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {posting ? "Posting..." : "Post Note"}
            </button>
          </div>
        </form>

        <NotesFeed notes={notes} showBusinessName={false} className="mt-4" />
      </section>

      <ClientFormModal
        open={editOpen}
        client={client}
        onClose={() => setEditOpen(false)}
        onSaved={fetchClient}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete Client"
        message={
          <>
            Delete{" "}
            <span className="font-medium text-gray-100">{client.business_name}</span>?
            This will also delete all chatter notes for this client. This can&apos;t be undone.
          </>
        }
        busy={deleting}
        onConfirm={handleDeleteClient}
        onCancel={() => (deleting ? undefined : setDeleteOpen(false))}
      />

      <TaskFormModal
        open={taskModalOpen}
        task={editingTask}
        team={team}
        clients={[client]}
        defaultClientId={client.id}
        lockClient
        onClose={closeTaskModal}
        onSaved={fetchTasks}
      />

      <ConfirmDialog
        open={!!deleteTaskTarget}
        title="Delete Task"
        message={
          deleteTaskTarget && (
            <>
              Delete task{" "}
              <span className="font-medium text-gray-100">
                &apos;{deleteTaskTarget.title}&apos;
              </span>
              ? This can&apos;t be undone.
            </>
          )
        }
        busy={deletingTask}
        onConfirm={confirmDeleteTask}
        onCancel={() => (deletingTask ? undefined : setDeleteTaskTarget(null))}
      />
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-gray-100">{children}</dd>
    </div>
  );
}

function Dash() {
  return <span className="text-gray-500">—</span>;
}
