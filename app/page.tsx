"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ListPlus,
  Pencil,
  Trash2,
  Plus,
  Search,
} from "lucide-react";
import {
  Client,
  daysUntilNextBill,
  formatCurrency,
  upcomingWindow,
} from "@/lib/clients";
import { Task, TeamMember } from "@/lib/tasks";
import { ClientFormModal } from "@/components/ClientFormModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TaskFormModal } from "@/components/TaskFormModal";
import { TaskList } from "@/components/TaskList";

const TASKS_DASHBOARD_LIMIT = 10;

type StatusTab = "pending" | "done";

type SortKey =
  | "business_name"
  | "uses_ghl"
  | "retainer"
  | "bill_date"
  | "ad_spend_dates"
  | "active"
  | "billing_method";
type SortDir = "asc" | "desc";

export default function DashboardPage() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("business_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ---- Tasks state ----
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all"); // "all" or numeric id
  const [statusTab, setStatusTab] = useState<StatusTab>("pending");
  const [showAllTasks, setShowAllTasks] = useState(false);

  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskDefaultClientId, setTaskDefaultClientId] = useState<number | null>(null);

  const [deleteTaskTarget, setDeleteTaskTarget] = useState<Task | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);

  async function fetchClients() {
    try {
      const res = await fetch("/api/clients", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to fetch clients (${res.status})`);
      const data: Client[] = await res.json();
      setClients(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load clients");
      setClients([]);
    }
  }

  async function fetchTeam() {
    try {
      const res = await fetch("/api/team", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to fetch team (${res.status})`);
      const data: TeamMember[] = await res.json();
      setTeam(data);
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchTasks(status: StatusTab, assignee: string) {
    setTasksError(null);
    try {
      const params = new URLSearchParams({ status });
      if (assignee !== "all") params.set("assignee_id", assignee);
      const res = await fetch(`/api/tasks?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to fetch tasks (${res.status})`);
      const data: Task[] = await res.json();
      setTasks(data);
    } catch (err) {
      setTasksError(err instanceof Error ? err.message : "Failed to load tasks");
      setTasks([]);
    }
  }

  useEffect(() => {
    fetchClients();
    fetchTeam();
  }, []);

  useEffect(() => {
    setTasks(null);
    setShowAllTasks(false);
    fetchTasks(statusTab, assigneeFilter);
  }, [statusTab, assigneeFilter]);

  const stats = useMemo(() => computeStats(clients ?? []), [clients]);
  const upcoming = useMemo(() => computeUpcoming(clients ?? []), [clients]);

  const filtered = useMemo(() => {
    if (!clients) return [];
    const q = search.trim().toLowerCase();
    const base = q
      ? clients.filter((c) => c.business_name.toLowerCase().includes(q))
      : clients.slice();
    base.sort(makeClientComparator(sortKey, sortDir));
    return base;
  }, [clients, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const isLoading = clients === null;

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(c: Client) {
    setEditing(c);
    setModalOpen(true);
  }
  function closeModal() {
    setModalOpen(false);
    setEditing(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const name = deleteTarget.business_name;
    setDeleting(true);
    try {
      const res = await fetch(`/api/clients/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      setDeleteTarget(null);
      await fetchClients();
      toast.success(`Deleted ${name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      setLoadError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }

  function openTaskCreate() {
    setEditingTask(null);
    setTaskDefaultClientId(null);
    setTaskModalOpen(true);
  }
  function openTaskCreateForClient(c: Client) {
    setEditingTask(null);
    setTaskDefaultClientId(c.id);
    setTaskModalOpen(true);
  }
  function openTaskEdit(t: Task) {
    setEditingTask(t);
    setTaskDefaultClientId(null);
    setTaskModalOpen(true);
  }
  function closeTaskModal() {
    setTaskModalOpen(false);
    setEditingTask(null);
    setTaskDefaultClientId(null);
  }

  async function toggleTaskStatus(t: Task) {
    const next = t.status === "done" ? "pending" : "done";
    // optimistic
    setTasks((prev) =>
      prev
        ? prev.map((row) => (row.id === t.id ? { ...row, status: next } : row))
        : prev,
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
      // Refresh so it reflects the active tab/filter ordering.
      await fetchTasks(statusTab, assigneeFilter);
      toast.success(next === "done" ? "Task marked done" : "Task reopened");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update task";
      setTasksError(message);
      toast.error(message);
      // rollback
      await fetchTasks(statusTab, assigneeFilter);
    }
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
      await fetchTasks(statusTab, assigneeFilter);
      toast.success("Task deleted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      setTasksError(message);
      toast.error(message);
    } finally {
      setDeletingTask(false);
    }
  }

  const visibleTasks = useMemo(() => {
    if (!tasks) return [];
    if (showAllTasks) return tasks;
    return tasks.slice(0, TASKS_DASHBOARD_LIMIT);
  }, [tasks, showAllTasks]);

  const hasMoreTasks = tasks !== null && tasks.length > TASKS_DASHBOARD_LIMIT;

  return (
    <div className="space-y-8">
      <StatsBar
        loading={isLoading}
        mrr={stats.mrr}
        active={stats.active}
        inactive={stats.inactive}
        upcomingCount={upcoming.length}
      />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-brand-gold">
          Upcoming Bills (Next 7 Days)
        </h2>
        <UpcomingBillsTable rows={upcoming} loading={isLoading} />
      </section>

      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-brand-gold">Tasks</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="rounded-md border border-white/10 bg-brand-card px-3 py-1.5 text-sm text-gray-100 focus:border-brand-gold focus:outline-none focus:ring-1 focus:ring-brand-gold"
              aria-label="Filter by assignee"
            >
              <option value="all">All</option>
              {team.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.name}
                </option>
              ))}
            </select>

            <div className="inline-flex overflow-hidden rounded-md border border-white/10">
              <TabButton
                active={statusTab === "pending"}
                onClick={() => setStatusTab("pending")}
              >
                Pending
              </TabButton>
              <TabButton
                active={statusTab === "done"}
                onClick={() => setStatusTab("done")}
              >
                Completed
              </TabButton>
            </div>

            <button
              type="button"
              onClick={openTaskCreate}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-gold px-3 py-1.5 text-sm font-semibold text-brand-navy hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              New Task
            </button>
          </div>
        </div>

        {tasksError && (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {tasksError}
          </div>
        )}

        <TaskList
          tasks={visibleTasks}
          loading={tasks === null}
          onToggle={toggleTaskStatus}
          onEdit={openTaskEdit}
          onDelete={(t) => setDeleteTaskTarget(t)}
        />

        {hasMoreTasks && !showAllTasks && (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => setShowAllTasks(true)}
              className="text-sm text-brand-gold hover:underline"
            >
              View all ({tasks!.length})
            </button>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-brand-gold">All Clients</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clients..."
                className="w-full rounded-md border border-white/10 bg-brand-card py-1.5 pl-8 pr-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-brand-gold focus:outline-none focus:ring-1 focus:ring-brand-gold sm:w-64"
              />
            </div>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-gold px-3 py-1.5 text-sm font-semibold text-brand-navy hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              New Client
            </button>
          </div>
        </div>

        {loadError && (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {loadError}
          </div>
        )}

        <ClientsTable
          rows={filtered}
          loading={isLoading}
          hasAnyClients={(clients?.length ?? 0) > 0}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={toggleSort}
          onEdit={openEdit}
          onDelete={(c) => setDeleteTarget(c)}
          onCreateTask={openTaskCreateForClient}
        />
      </section>

      <ClientFormModal
        open={modalOpen}
        client={editing}
        onClose={closeModal}
        onSaved={fetchClients}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Client"
        message={
          deleteTarget && (
            <>
              Delete <span className="font-medium text-gray-100">{deleteTarget.business_name}</span>?
              This will also delete all chatter notes for this client. This can&apos;t be undone.
            </>
          )
        }
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => (deleting ? undefined : setDeleteTarget(null))}
      />

      <TaskFormModal
        open={taskModalOpen}
        task={editingTask}
        team={team}
        clients={clients ?? []}
        defaultClientId={taskDefaultClientId}
        onClose={closeTaskModal}
        onSaved={() => fetchTasks(statusTab, assigneeFilter)}
      />

      <ConfirmDialog
        open={!!deleteTaskTarget}
        title="Delete Task"
        message={
          deleteTaskTarget && (
            <>
              Delete task <span className="font-medium text-gray-100">&apos;{deleteTaskTarget.title}&apos;</span>?
              This can&apos;t be undone.
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

// ---------- stats ----------

function computeStats(clients: Client[]) {
  let mrr = 0;
  let active = 0;
  let inactive = 0;
  for (const c of clients) {
    if (c.active) {
      mrr += c.retainer;
      active++;
    } else {
      inactive++;
    }
  }
  return { mrr, active, inactive };
}

type UpcomingRow = {
  client: Client;
  matchedDay: number;
  daysUntil: number;
};

function computeUpcoming(clients: Client[]): UpcomingRow[] {
  const window = upcomingWindow();
  const rows: UpcomingRow[] = [];
  for (const c of clients) {
    if (!c.active) continue;
    const daysUntil = daysUntilNextBill(c.bill_date, window);
    if (daysUntil === null) continue;
    const match = window.find((w) => w.daysUntil === daysUntil)!;
    rows.push({ client: c, matchedDay: match.day, daysUntil });
  }
  rows.sort((a, b) => a.daysUntil - b.daysUntil);
  return rows;
}

// ---------- stats bar ----------

function StatsBar({
  loading,
  mrr,
  active,
  inactive,
  upcomingCount,
}: {
  loading: boolean;
  mrr: number;
  active: number;
  inactive: number;
  upcomingCount: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Total MRR" value={loading ? "—" : formatCurrency(mrr)} accent />
      <StatCard label="Active Clients" value={loading ? "—" : active.toString()} />
      <StatCard label="Inactive Clients" value={loading ? "—" : inactive.toString()} />
      <StatCard
        label="Upcoming Bills (7d)"
        value={loading ? "—" : upcomingCount.toString()}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-brand-card p-5 shadow-lg">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div
        className={`mt-2 text-2xl font-semibold ${
          accent ? "text-brand-gold" : "text-gray-100"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

// ---------- upcoming bills table ----------

function UpcomingBillsTable({
  rows,
  loading,
}: {
  rows: UpcomingRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="overflow-hidden rounded-lg border border-white/5 bg-brand-card">
        <SkeletonRows columns={5} count={3} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-white/5 bg-brand-card p-5 text-sm text-gray-500">
        No bills due in the next 7 days.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-white/5 bg-brand-card">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-white/5 text-xs uppercase tracking-wide text-gray-400">
          <tr>
            <Th>Business Name</Th>
            <Th>Bill Day</Th>
            <Th>Retainer</Th>
            <Th>Method</Th>
            <Th>Days Until</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.client.id}
              className="border-b border-white/5 last:border-b-0 hover:bg-white/5"
            >
              <Td>
                <Link
                  href={`/clients/${r.client.id}`}
                  className="text-gray-100 hover:text-brand-gold"
                >
                  {r.client.business_name}
                </Link>
              </Td>
              <Td>{ordinal(r.matchedDay)}</Td>
              <Td>{formatCurrency(r.client.retainer)}</Td>
              <Td>{r.client.billing_method ?? "—"}</Td>
              <Td>
                <span className="inline-flex items-center rounded-full bg-brand-gold/10 px-2 py-0.5 text-xs font-medium text-brand-gold">
                  {daysUntilLabel(r.daysUntil)}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function daysUntilLabel(d: number): string {
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  return `${d} days`;
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

// ---------- tasks list ----------

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-brand-gold text-brand-navy font-semibold"
          : "bg-transparent text-gray-300 hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

// ---------- clients table ----------

function ClientsTable({
  rows,
  loading,
  hasAnyClients,
  sortKey,
  sortDir,
  onSort,
  onEdit,
  onDelete,
  onCreateTask,
}: {
  rows: Client[];
  loading: boolean;
  hasAnyClients: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onEdit: (c: Client) => void;
  onDelete: (c: Client) => void;
  onCreateTask: (c: Client) => void;
}) {
  if (loading) {
    return (
      <div className="overflow-hidden rounded-lg border border-white/5 bg-brand-card">
        <SkeletonRows columns={8} count={5} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-white/5 bg-brand-card p-5 text-sm text-gray-500">
        {hasAnyClients
          ? "No clients match your search."
          : "No clients yet. Click '+ New Client' to add your first one."}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-white/5 bg-brand-card">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-white/5 text-xs uppercase tracking-wide text-gray-400">
          <tr>
            <SortableTh sortKey="business_name" active={sortKey} dir={sortDir} onSort={onSort}>
              Business Name
            </SortableTh>
            <SortableTh
              sortKey="uses_ghl"
              active={sortKey}
              dir={sortDir}
              onSort={onSort}
              className="hidden md:table-cell"
            >
              GHL
            </SortableTh>
            <SortableTh sortKey="retainer" active={sortKey} dir={sortDir} onSort={onSort}>
              Retainer
            </SortableTh>
            <SortableTh sortKey="bill_date" active={sortKey} dir={sortDir} onSort={onSort}>
              Bill Date
            </SortableTh>
            <SortableTh
              sortKey="ad_spend_dates"
              active={sortKey}
              dir={sortDir}
              onSort={onSort}
              className="hidden md:table-cell"
            >
              Ad Spend
            </SortableTh>
            <SortableTh sortKey="active" active={sortKey} dir={sortDir} onSort={onSort}>
              Active
            </SortableTh>
            <SortableTh
              sortKey="billing_method"
              active={sortKey}
              dir={sortDir}
              onSort={onSort}
              className="hidden md:table-cell"
            >
              Method
            </SortableTh>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr
              key={c.id}
              className="border-b border-white/5 last:border-b-0 hover:bg-white/5"
            >
              <Td>
                <Link
                  href={`/clients/${c.id}`}
                  className="font-medium text-gray-100 hover:text-brand-gold"
                >
                  {c.business_name}
                </Link>
              </Td>
              <Td className="hidden md:table-cell">
                {c.uses_ghl ? (
                  <span className="inline-flex items-center rounded-full bg-brand-gold/15 px-2 py-0.5 text-xs font-semibold text-brand-gold">
                    GHL
                  </span>
                ) : (
                  <span className="text-gray-500">—</span>
                )}
              </Td>
              <Td>{formatCurrency(c.retainer)}</Td>
              <Td>{c.bill_date ?? <span className="text-gray-500">—</span>}</Td>
              <Td className="hidden md:table-cell">
                {c.ad_spend_dates ?? <span className="text-gray-500">—</span>}
              </Td>
              <Td>
                <span className="inline-flex items-center gap-1.5 text-xs">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      c.active ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  {c.active ? "Active" : "Inactive"}
                </span>
              </Td>
              <Td className="hidden md:table-cell">
                {c.billing_method ?? <span className="text-gray-500">—</span>}
              </Td>
              <Td className="text-right">
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onEdit(c)}
                    aria-label={`Edit ${c.business_name}`}
                    className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-brand-gold"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onCreateTask(c)}
                    aria-label={`Create task for ${c.business_name}`}
                    title="Create task"
                    className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-brand-gold"
                  >
                    <ListPlus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(c)}
                    aria-label={`Delete ${c.business_name}`}
                    className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- table primitives ----------

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-4 py-3 font-medium ${className}`}>{children}</th>;
}

function SortableTh({
  sortKey,
  active,
  dir,
  onSort,
  className = "",
  children,
}: {
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const isActive = active === sortKey;
  const Icon = isActive ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={`px-4 py-3 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-brand-gold ${
          isActive ? "text-brand-gold" : ""
        }`}
      >
        <span>{children}</span>
        <Icon className={`h-3 w-3 ${isActive ? "opacity-100" : "opacity-40"}`} />
      </button>
    </th>
  );
}

function makeClientComparator(
  key: SortKey,
  dir: SortDir,
): (a: Client, b: Client) => number {
  const mult = dir === "asc" ? 1 : -1;
  return (a, b) => {
    const av = a[key];
    const bv = b[key];

    // Null/empty always sorts to the end regardless of direction.
    const aEmpty = av === null || av === "";
    const bEmpty = bv === null || bv === "";
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;

    let cmp = 0;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else if (typeof av === "boolean" && typeof bv === "boolean") {
      cmp = av === bv ? 0 : av ? -1 : 1; // true first in asc
    } else {
      cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
    }
    if (cmp === 0) {
      // Stable tiebreaker on business name.
      cmp = a.business_name.localeCompare(b.business_name, undefined, {
        sensitivity: "base",
      });
    }
    return cmp * mult;
  };
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 text-gray-200 ${className}`}>{children}</td>;
}

function SkeletonRows({ columns, count }: { columns: number; count: number }) {
  return (
    <div className="divide-y divide-white/5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3">
          {Array.from({ length: columns }).map((_, j) => (
            <div
              key={j}
              className="h-4 flex-1 animate-pulse rounded bg-white/5"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
