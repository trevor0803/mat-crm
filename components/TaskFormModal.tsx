"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Priority, Task, TeamMember } from "@/lib/tasks";
import type { Client } from "@/lib/clients";

type Props = {
  open: boolean;
  task?: Task | null; // null/undefined = create; provided = edit
  team: TeamMember[];
  clients: Client[];
  defaultClientId?: number | null; // preselect client when creating
  lockClient?: boolean; // hide the client picker entirely
  onClose: () => void;
  onSaved: () => void;
};

type FormState = {
  title: string;
  description: string;
  due_date: string;
  priority: Priority;
  assignee_id: string; // "" or numeric string
  client_id: string; // "" or numeric string
};

function initialState(
  task?: Task | null,
  team: TeamMember[] = [],
  defaultClientId?: number | null,
): FormState {
  if (!task) {
    return {
      title: "",
      description: "",
      due_date: "",
      priority: "medium",
      assignee_id: team.length > 0 ? String(team[0].id) : "",
      client_id: defaultClientId != null ? String(defaultClientId) : "",
    };
  }
  return {
    title: task.title,
    description: task.description ?? "",
    due_date: task.due_date ?? "",
    priority: task.priority,
    assignee_id: String(task.assignee_id),
    client_id: task.client_id !== null ? String(task.client_id) : "",
  };
}

export function TaskFormModal({
  open,
  task,
  team,
  clients,
  defaultClientId,
  lockClient = false,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<FormState>(() =>
    initialState(task, team, defaultClientId),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!task;

  useEffect(() => {
    if (open) {
      setForm(initialState(task, team, defaultClientId));
      setError(null);
      setSubmitting(false);
    }
  }, [open, task, team, defaultClientId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const title = form.title.trim();
    if (!title) {
      setError("Title is required.");
      return;
    }
    if (form.assignee_id === "") {
      setError("Assignee is required.");
      return;
    }
    const assigneeId = Number(form.assignee_id);
    if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
      setError("Invalid assignee.");
      return;
    }
    const clientId = form.client_id === "" ? null : Number(form.client_id);
    if (clientId !== null && (!Number.isInteger(clientId) || clientId <= 0)) {
      setError("Invalid client.");
      return;
    }

    const payload: Record<string, unknown> = {
      title,
      description: form.description.trim() === "" ? null : form.description,
      due_date: form.due_date === "" ? null : form.due_date,
      priority: form.priority,
      assignee_id: assigneeId,
      client_id: clientId,
    };

    setSubmitting(true);
    try {
      const url = isEdit ? `/api/tasks/${task!.id}` : "/api/tasks";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message = body?.error ?? `Request failed (${res.status})`;
        setError(message);
        toast.error(message);
        setSubmitting(false);
        return;
      }
      onSaved();
      onClose();
      toast.success(isEdit ? "Task updated" : "Task created");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setError(message);
      toast.error(message);
      setSubmitting(false);
    }
  }

  const sortedClients = [...clients].sort((a, b) =>
    a.business_name.localeCompare(b.business_name),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => {
          if (!submitting) onClose();
        }}
      />
      <div className="relative flex min-h-full w-full max-w-lg flex-col border-white/10 bg-brand-card p-6 shadow-2xl sm:my-8 sm:min-h-0 sm:rounded-lg sm:border">
        <h3 className="text-lg font-semibold text-brand-gold">
          {isEdit ? "Edit Task" : "New Task"}
        </h3>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <Field label="Title" required>
            <input
              type="text"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              className={inputClass}
              required
              autoFocus
            />
          </Field>

          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              rows={3}
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Due Date">
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => update("due_date", e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Priority">
              <select
                value={form.priority}
                onChange={(e) => update("priority", e.target.value as Priority)}
                className={inputClass}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
          </div>

          <Field label="Assignee" required>
            <select
              value={form.assignee_id}
              onChange={(e) => update("assignee_id", e.target.value)}
              className={inputClass}
              required
            >
              {form.assignee_id === "" && <option value="">Select…</option>}
              {team.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>

          {!lockClient && (
            <Field label="Client">
              <select
                value={form.client_id}
                onChange={(e) => update("client_id", e.target.value)}
                className={inputClass}
              >
                <option value="">— None —</option>
                {sortedClients.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.business_name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-white/10 px-4 py-2 text-sm text-gray-200 hover:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-brand-gold px-4 py-2 text-sm font-semibold text-brand-navy hover:brightness-110 disabled:opacity-50"
            >
              {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-white/10 bg-brand-navy px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-brand-gold focus:outline-none focus:ring-1 focus:ring-brand-gold";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
        {required && <span className="ml-0.5 text-brand-gold">*</span>}
      </span>
      {children}
    </label>
  );
}
