// Shared logic for the Daily Planner: a fixed 9:00 AM – 5:00 PM grid of
// 30-minute slots, designed to be ADHD-friendly (one "now" block at a time).
// Used by both the API route (validation) and the planner page (UI).

export type SlotEnergy = "deep" | "admin" | "meeting" | "break" | "buffer";

export type PlannerSlot = {
  id: number;
  plan_date: string; // YYYY-MM-DD
  slot_time: string; // "HH:MM" (24h), always one of SLOT_TIMES
  title: string;
  task_id: number | null;
  energy: SlotEnergy | null;
  done: boolean;
};

// Planned day runs 9:00 AM through 5:00 PM. The last block starts at 16:30
// and ends at 17:00 — sixteen 30-minute slots total.
export const PLANNER_START_MINUTES = 9 * 60; // 9:00 AM
export const PLANNER_END_MINUTES = 17 * 60; // 5:00 PM
export const SLOT_MINUTES = 30;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function minutesToHHMM(mins: number): string {
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

// ["09:00", "09:30", ... "16:30"]
export const SLOT_TIMES: string[] = (() => {
  const out: string[] = [];
  for (let m = PLANNER_START_MINUTES; m < PLANNER_END_MINUTES; m += SLOT_MINUTES) {
    out.push(minutesToHHMM(m));
  }
  return out;
})();

const SLOT_TIME_SET = new Set(SLOT_TIMES);

export function isValidSlotTime(t: unknown): t is string {
  return typeof t === "string" && SLOT_TIME_SET.has(t);
}

export const ENERGIES: SlotEnergy[] = ["deep", "admin", "meeting", "break", "buffer"];

export function isValidEnergy(e: unknown): e is SlotEnergy {
  return typeof e === "string" && (ENERGIES as string[]).includes(e);
}

// Display + color metadata for each energy type. Tailwind only sees literal
// class strings, so these must be spelled out in full (no string building).
export const ENERGY_META: Record<
  SlotEnergy,
  { label: string; dot: string; chip: string; ring: string }
> = {
  deep: {
    label: "Deep focus",
    dot: "bg-violet-400",
    chip: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    ring: "ring-violet-400/50",
  },
  admin: {
    label: "Admin",
    dot: "bg-sky-400",
    chip: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    ring: "ring-sky-400/50",
  },
  meeting: {
    label: "Meeting",
    dot: "bg-amber-400",
    chip: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    ring: "ring-amber-400/50",
  },
  break: {
    label: "Break",
    dot: "bg-emerald-400",
    chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    ring: "ring-emerald-400/50",
  },
  buffer: {
    label: "Buffer / flex",
    dot: "bg-gray-400",
    chip: "bg-white/10 text-gray-300 border-white/20",
    ring: "ring-gray-400/50",
  },
};

// Format "HH:MM" (24h) as "9:00 AM".
export function formatSlotLabel(slot: string): string {
  const [hStr, mStr] = slot.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ampm}`;
}

// Format a YYYY-MM-DD string as a local date "Mon, Jun 24". Parsed manually so
// it isn't shifted by the browser timezone (new Date("YYYY-MM-DD") is UTC).
export function formatDateHeading(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}

// The local YYYY-MM-DD for a Date (not UTC), so "today" matches the calendar.
export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Shift a YYYY-MM-DD string by `deltaDays`, staying in local time.
export function shiftDate(date: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + deltaDays);
  return toDateString(d);
}

export type CurrentSlot = {
  slotTime: string; // the active slot in SLOT_TIMES
  index: number;
  minutesLeft: number; // until this slot ends
};

// Which 30-min slot `now` falls into, or null if before 9 / after 5.
export function currentSlot(now: Date): CurrentSlot | null {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < PLANNER_START_MINUTES || mins >= PLANNER_END_MINUTES) return null;
  const offset = mins - PLANNER_START_MINUTES;
  const index = Math.floor(offset / SLOT_MINUTES);
  const slotStart = PLANNER_START_MINUTES + index * SLOT_MINUTES;
  const slotEnd = slotStart + SLOT_MINUTES;
  return {
    slotTime: SLOT_TIMES[index],
    index,
    minutesLeft: slotEnd - mins,
  };
}
