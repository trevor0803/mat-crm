"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Target,
  X,
  Plus,
  Check,
  Brain,
  Trash2,
  CalendarDays,
  Bell,
  BellOff,
} from "lucide-react";
import {
  SLOT_TIMES,
  type PlannerSlot,
  formatSlotLabel,
  formatDateHeading,
  toDateString,
  shiftDate,
  currentSlot,
} from "@/lib/planner";

type PlannerTask = {
  id: number;
  title: string;
  due_date: string | null;
  priority: "low" | "medium" | "high";
  category: "work" | "billing";
  client_id: number | null;
  business_name: string | null;
  assignee_name: string;
};

type SlotMap = Record<string, PlannerSlot>;

const BRAINDUMP_KEY = "planner-braindump";

function emptySlot(date: string, slot_time: string): PlannerSlot {
  return {
    id: -1,
    plan_date: date,
    slot_time,
    title: "",
    task_id: null,
    energy: null,
    done: false,
  };
}

export default function PlannerPage() {
  const [date, setDate] = useState(() => toDateString(new Date()));
  const [slots, setSlots] = useState<SlotMap>({});
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [confirmClear, setConfirmClear] = useState(false);
  const [alertsOn, setAlertsOn] = useState(false);
  // The slot we've already announced, so each block notifies only once.
  const notifiedSlotRef = useRef<string | null>(null);

  const todayStr = toDateString(now);
  const isToday = date === todayStr;

  // Tick the clock so the "now" highlight + focus timer stay live.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Restore the alert preference (only if the browser still has permission).
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (localStorage.getItem("planner-alerts") === "1" && Notification.permission === "granted") {
      setAlertsOn(true);
    }
  }, []);

  async function enableAlerts() {
    if (typeof Notification === "undefined") {
      toast.error("This browser doesn't support notifications.");
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") {
      toast.error("Notifications are blocked — turn them on in your browser's site settings.");
      return;
    }
    setAlertsOn(true);
    localStorage.setItem("planner-alerts", "1");
    // Anchor to the current block so we don't immediately re-announce it.
    notifiedSlotRef.current = currentSlot(new Date())?.slotTime ?? null;
    new Notification("Planner alerts on", {
      body: "Keep this tab open — you'll get a nudge at the start of each block.",
    });
  }

  function disableAlerts() {
    setAlertsOn(false);
    localStorage.removeItem("planner-alerts");
  }

  // Fire a notification when the clock crosses into a new block (today only,
  // while this tab is open). Re-runs on each 15s tick; the ref dedupes.
  useEffect(() => {
    if (!alertsOn || !isToday) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const c = currentSlot(now);
    if (!c || notifiedSlotRef.current === c.slotTime) return;
    notifiedSlotRef.current = c.slotTime;
    const s = slots[c.slotTime];
    new Notification(`Now · ${formatSlotLabel(c.slotTime)}`, {
      body: s?.title ? s.title : "No plan for this block — pick one thing.",
    });
  }, [now, alertsOn, isToday, slots]);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/planner?date=${d}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load");
      const map: SlotMap = {};
      for (const s of data.slots as PlannerSlot[]) map[s.slot_time] = s;
      setSlots(map);
      setTasks(data.tasks as PlannerTask[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  // Persist one slot. `patch` is merged over the slot's current values; the
  // server replaces the whole row, so we always send the full merged state.
  const saveSlot = useCallback(
    async (slot_time: string, patch: Partial<PlannerSlot>) => {
      const prev = slots[slot_time] ?? emptySlot(date, slot_time);
      const merged: PlannerSlot = { ...prev, ...patch };
      // Optimistic update.
      setSlots((s) => ({ ...s, [slot_time]: merged }));
      try {
        const res = await fetch("/api/planner", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date,
            slot_time,
            title: merged.title,
            task_id: merged.task_id,
            energy: merged.energy,
            done: merged.done,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Save failed");
        setSlots((s) => {
          const next = { ...s };
          if (data.slot === null) delete next[slot_time];
          else next[slot_time] = data.slot;
          return next;
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
        load(date); // reconcile with the server
      }
    },
    [slots, date, load],
  );

  const scheduledTaskIds = useMemo(() => {
    const set = new Set<number>();
    for (const t of Object.values(slots)) if (t.task_id) set.add(t.task_id);
    return set;
  }, [slots]);

  const cur = isToday ? currentSlot(now) : null;

  // Place a task (or free text) into the first open slot, preferring slots at
  // or after the current time when viewing today.
  const placeInNextOpenSlot = useCallback(
    (patch: Partial<PlannerSlot>, label: string) => {
      const startIdx = cur ? cur.index : 0;
      const order = [
        ...SLOT_TIMES.slice(startIdx),
        ...SLOT_TIMES.slice(0, startIdx),
      ];
      const open = order.find((t) => {
        const s = slots[t];
        return !s || (!s.title && !s.task_id && !s.done);
      });
      if (!open) {
        toast.error("No open slots left — clear one first.");
        return;
      }
      saveSlot(open, patch);
      toast.success(`Added “${label}” at ${formatSlotLabel(open)}`);
    },
    [slots, cur, saveSlot],
  );

  const plannedCount = useMemo(
    () => Object.values(slots).filter((s) => s.title || s.task_id).length,
    [slots],
  );
  const doneCount = useMemo(
    () => Object.values(slots).filter((s) => s.done).length,
    [slots],
  );

  async function clearDay() {
    const filled = Object.values(slots).filter((s) => s.title || s.task_id || s.done);
    setConfirmClear(false);
    setSlots({});
    await Promise.all(
      filled.map((s) =>
        fetch(`/api/planner?date=${date}&slot_time=${s.slot_time}`, {
          method: "DELETE",
        }),
      ),
    );
    load(date);
    toast.success("Day cleared");
  }

  return (
    <div>
      {/* ---- Header ---- */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-100">
            Daily Planner
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            9:00 AM – 5:00 PM, one block at a time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={alertsOn ? disableAlerts : enableAlerts}
            title={
              alertsOn
                ? "Block alerts are on (keep this tab open). Click to turn off."
                : "Get a browser notification at the start of each block."
            }
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              alertsOn
                ? "border-brand-gold/50 bg-brand-gold/15 text-brand-gold"
                : "border-brand-card text-gray-300 hover:bg-brand-card"
            }`}
          >
            {alertsOn ? <Bell size={16} /> : <BellOff size={16} />}
            {alertsOn ? "Alerts on" : "Enable alerts"}
          </button>
          <button
            onClick={() => {
              if (!isToday) setDate(todayStr);
              setFocus(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-brand-navy transition hover:brightness-110"
          >
            <Target size={16} /> Focus mode
          </button>
        </div>
      </div>

      {/* ---- Date nav + progress ---- */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDate((d) => shiftDate(d, -1))}
            aria-label="Previous day"
            className="rounded-lg border border-brand-card p-2 text-gray-300 transition hover:bg-brand-card"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="min-w-[10.5rem] text-center text-sm font-medium text-gray-100">
            {formatDateHeading(date)}
            {isToday && (
              <span className="ml-2 rounded-full bg-brand-gold/15 px-2 py-0.5 text-xs text-brand-gold">
                Today
              </span>
            )}
          </div>
          <button
            onClick={() => setDate((d) => shiftDate(d, 1))}
            aria-label="Next day"
            className="rounded-lg border border-brand-card p-2 text-gray-300 transition hover:bg-brand-card"
          >
            <ChevronRight size={16} />
          </button>
          {!isToday && (
            <button
              onClick={() => setDate(todayStr)}
              className="ml-1 inline-flex items-center gap-1 rounded-lg border border-brand-card px-3 py-2 text-xs text-gray-300 transition hover:bg-brand-card"
            >
              <CalendarDays size={14} /> Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span>
            <span className="font-semibold text-gray-200">{plannedCount}</span>/
            {SLOT_TIMES.length} planned
          </span>
          <span>
            <span className="font-semibold text-emerald-300">{doneCount}</span> done
          </span>
          {confirmClear ? (
            <span className="inline-flex items-center gap-1">
              <button
                onClick={clearDay}
                className="rounded bg-red-500/20 px-2 py-1 text-red-300 hover:bg-red-500/30"
              >
                Clear day?
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="rounded px-2 py-1 text-gray-400 hover:text-gray-200"
              >
                no
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-300"
            >
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ---- Time grid ---- */}
        <div className="lg:col-span-2">
          <div className="space-y-1.5">
            {SLOT_TIMES.map((t, i) => (
              <SlotRow
                key={t}
                slotTime={t}
                slot={slots[t]}
                isCurrent={cur?.slotTime === t}
                isPast={cur ? i < cur.index : false}
                onSave={(patch) => saveSlot(t, patch)}
              />
            ))}
          </div>
        </div>

        {/* ---- Sidebar ---- */}
        <div className="space-y-6">
          <TaskPanel
            tasks={tasks}
            loading={loading}
            scheduledTaskIds={scheduledTaskIds}
            onPlace={(task) =>
              placeInNextOpenSlot(
                { title: task.title, task_id: task.id, done: false },
                task.title,
              )
            }
          />
          <BrainDump
            onPlace={(text) =>
              placeInNextOpenSlot({ title: text, task_id: null, done: false }, text)
            }
          />
        </div>
      </div>

      {focus && (
        <FocusOverlay
          now={now}
          cur={cur}
          slots={slots}
          onClose={() => setFocus(false)}
          onSave={saveSlot}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Slot row                                                            */
/* ------------------------------------------------------------------ */

function SlotRow({
  slotTime,
  slot,
  isCurrent,
  isPast,
  onSave,
}: {
  slotTime: string;
  slot: PlannerSlot | undefined;
  isCurrent: boolean;
  isPast: boolean;
  onSave: (patch: Partial<PlannerSlot>) => void;
}) {
  const title = slot?.title ?? "";
  const done = slot?.done ?? false;
  const linked = Boolean(slot?.task_id);

  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);

  const commit = () => {
    if (draft.trim() !== title) onSave({ title: draft.trim() });
  };

  return (
    <div
      className={`flex items-stretch gap-2 rounded-lg border bg-brand-card/60 px-2 py-1.5 transition ${
        isCurrent
          ? "border-brand-gold/70 ring-1 ring-brand-gold/40"
          : "border-brand-card"
      } ${isPast && !done ? "opacity-55" : ""}`}
    >
      {/* time + now marker */}
      <div className="flex w-20 shrink-0 flex-col justify-center pl-1">
        <span
          className={`text-xs font-medium ${
            isCurrent ? "text-brand-gold" : "text-gray-400"
          }`}
        >
          {formatSlotLabel(slotTime)}
        </span>
        {isCurrent && (
          <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-brand-gold">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-gold" />
            Now
          </span>
        )}
      </div>

      {/* title input */}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="—"
        className={`min-w-0 flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-gray-600 ${
          done ? "text-gray-500 line-through" : "text-gray-100"
        }`}
      />

      {/* done toggle */}
      <button
        onClick={() => onSave({ done: !done })}
        aria-label={done ? "Mark not done" : "Mark done"}
        className={`flex h-6 w-6 shrink-0 items-center justify-center self-center rounded-md border transition ${
          done
            ? "border-emerald-400 bg-emerald-400/20 text-emerald-300"
            : "border-gray-600 text-transparent hover:border-gray-400"
        }`}
      >
        <Check size={14} />
      </button>

      {/* clear */}
      {(title || linked || done) && (
        <button
          onClick={() => onSave({ title: "", task_id: null, energy: null, done: false })}
          aria-label="Clear slot"
          className="flex h-6 w-6 shrink-0 items-center justify-center self-center rounded-md text-gray-600 transition hover:bg-white/5 hover:text-gray-300"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Task panel                                                          */
/* ------------------------------------------------------------------ */

function TaskPanel({
  tasks,
  loading,
  scheduledTaskIds,
  onPlace,
}: {
  tasks: PlannerTask[];
  loading: boolean;
  scheduledTaskIds: Set<number>;
  onPlace: (task: PlannerTask) => void;
}) {
  return (
    <div className="rounded-xl border border-brand-card bg-brand-card/40 p-4">
      <h2 className="mb-1 text-sm font-semibold text-gray-100">Today’s CRM tasks</h2>
      <p className="mb-3 text-xs text-gray-500">
        Open tasks due today or overdue. Drop one into the next open block.
      </p>
      {loading ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-xs text-gray-500">Nothing due. Enjoy the open day.</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const placed = scheduledTaskIds.has(task.id);
            return (
              <li
                key={task.id}
                className="flex items-start gap-2 rounded-lg border border-brand-card bg-brand-navy/40 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-100">{task.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500">
                    {task.business_name && <span>{task.business_name}</span>}
                    <span
                      className={
                        task.category === "billing"
                          ? "text-emerald-400/80"
                          : "text-gray-500"
                      }
                    >
                      {task.category}
                    </span>
                    {task.priority === "high" && (
                      <span className="text-red-400/80">high</span>
                    )}
                  </p>
                </div>
                {placed ? (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-emerald-300">
                    <Check size={12} /> set
                  </span>
                ) : (
                  <button
                    onClick={() => onPlace(task)}
                    className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-gold/15 px-2 py-1 text-[11px] font-medium text-brand-gold transition hover:bg-brand-gold/25"
                  >
                    <Plus size={12} /> Plan
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Brain dump                                                          */
/* ------------------------------------------------------------------ */

function BrainDump({ onPlace }: { onPlace: (text: string) => void }) {
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BRAINDUMP_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (next: string[]) => {
    setItems(next);
    try {
      localStorage.setItem(BRAINDUMP_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    persist([v, ...items]);
    setDraft("");
  };

  const remove = (i: number) => persist(items.filter((_, idx) => idx !== i));

  return (
    <div className="rounded-xl border border-brand-card bg-brand-card/40 p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-100">
        <Brain size={15} className="text-brand-gold" /> Brain dump
      </h2>
      <p className="mb-3 text-xs text-gray-500">
        A stray thought mid-block? Park it here, stay on task, deal with it later.
      </p>
      <div className="mb-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="Dump it…"
          className="min-w-0 flex-1 rounded-lg border border-brand-card bg-brand-navy/40 px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-600 focus:border-brand-gold/40"
        />
        <button
          onClick={add}
          className="rounded-lg bg-brand-gold/15 px-3 py-2 text-sm font-medium text-brand-gold transition hover:bg-brand-gold/25"
        >
          <Plus size={16} />
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-600">Empty — a clear head.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li
              key={i}
              className="group flex items-center gap-2 rounded-lg border border-brand-card bg-brand-navy/40 px-3 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{it}</span>
              <button
                onClick={() => {
                  onPlace(it);
                  remove(i);
                }}
                title="Schedule it"
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-brand-gold opacity-0 transition group-hover:opacity-100 hover:bg-brand-gold/15"
              >
                Plan
              </button>
              <button
                onClick={() => remove(i)}
                title="Delete"
                className="shrink-0 text-gray-600 transition hover:text-gray-300"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Focus overlay                                                       */
/* ------------------------------------------------------------------ */

function FocusOverlay({
  now,
  cur,
  slots,
  onClose,
  onSave,
}: {
  now: Date;
  cur: ReturnType<typeof currentSlot>;
  slots: SlotMap;
  onClose: () => void;
  onSave: (slot_time: string, patch: Partial<PlannerSlot>) => void;
}) {
  const slot = cur ? slots[cur.slotTime] : undefined;
  const nextSlotTime = cur && cur.index + 1 < SLOT_TIMES.length
    ? SLOT_TIMES[cur.index + 1]
    : null;
  const next = nextSlotTime ? slots[nextSlotTime] : undefined;

  const [draft, setDraft] = useState(slot?.title ?? "");
  useEffect(() => setDraft(slot?.title ?? ""), [slot?.title, cur?.slotTime]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-brand-navy/95 px-6 backdrop-blur">
      <button
        onClick={onClose}
        className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-lg border border-brand-card px-3 py-2 text-sm text-gray-300 transition hover:bg-brand-card"
      >
        <X size={16} /> Exit
      </button>

      {!cur ? (
        <div className="text-center">
          <p className="text-lg text-gray-300">Outside your planned hours.</p>
          <p className="mt-2 text-sm text-gray-500">
            The day runs 9:00 AM – 5:00 PM. Rest up.
          </p>
        </div>
      ) : (
        <div className="w-full max-w-xl text-center">
          <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-brand-gold/15 px-4 py-1 text-sm font-semibold uppercase tracking-wide text-brand-gold">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand-gold" />
            Now · {formatSlotLabel(cur.slotTime)}
          </p>
          <p className="mb-6 text-sm text-gray-500">
            {cur.minutesLeft} min left in this block
          </p>

          <p className="mb-3 text-xs uppercase tracking-wide text-gray-500">
            The one thing right now
          </p>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft.trim() !== (slot?.title ?? ""))
                onSave(cur.slotTime, { title: draft.trim() });
            }}
            placeholder="What are you doing this block?"
            className={`w-full border-b-2 border-brand-card bg-transparent pb-3 text-center text-3xl font-semibold outline-none placeholder:text-gray-700 focus:border-brand-gold/50 ${
              slot?.done ? "text-gray-500 line-through" : "text-gray-100"
            }`}
          />

          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              onClick={() => onSave(cur.slotTime, { done: !slot?.done })}
              className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition ${
                slot?.done
                  ? "bg-emerald-400/20 text-emerald-300"
                  : "bg-brand-gold text-brand-navy hover:brightness-110"
              }`}
            >
              <Check size={16} /> {slot?.done ? "Done" : "Mark done"}
            </button>
          </div>

          {next?.title && (
            <p className="mt-10 text-sm text-gray-500">
              Up next ·{" "}
              <span className="text-gray-300">{formatSlotLabel(nextSlotTime!)}</span> —{" "}
              {next.title}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
