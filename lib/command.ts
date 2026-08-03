// Shared types for the natural-language Command Box.
//
// This file is imported by BOTH the browser component and the server routes,
// so it must stay free of any secrets, database access, or Node-only imports.
// The server-only half (the Claude call + SQL execution) lives in
// lib/command-server.ts.

export const COMMAND_ACTION_KINDS = [
  "create_task",
  "complete_task",
  "update_task",
  "delete_task",
  "create_client",
  "update_client",
  "add_note",
  "plan_slot",
] as const;

export type CommandActionKind = (typeof COMMAND_ACTION_KINDS)[number];

export function isCommandActionKind(v: unknown): v is CommandActionKind {
  return typeof v === "string" && (COMMAND_ACTION_KINDS as readonly string[]).includes(v);
}

// One read-only row on a preview card ("Due" / "Aug 4, 2026").
export type PreviewField = { label: string; value: string };

// A single change the box proposes. Nothing is written to the database until
// the user hits Save and the same payload comes back to /api/command/execute,
// which re-validates it from scratch.
export type PlannedAction = {
  id: string;
  kind: CommandActionKind;
  /** Short heading for the preview card, e.g. "Add task". */
  title: string;
  /** One-line description of the change. */
  summary: string;
  /** Read-only detail rows shown on the card. */
  fields: PreviewField[];
  /** Things the user should eyeball before saving (unmatched client, etc.). */
  warnings: string[];
  /** Set for irreversible actions so the card renders in red. */
  destructive: boolean;
  /** Fully resolved, ready-to-execute values. Editable in the UI for tasks. */
  payload: Record<string, unknown>;
};

// Minimal client/team shapes the box needs to render its dropdowns, sent
// down with the parse response so the component needs no extra fetches.
export type CommandClient = { id: number; business_name: string; active: boolean };
export type CommandTeamMember = { id: number; name: string };

export type ParseResponse = {
  /** What the box heard, echoed back. */
  transcript: string;
  /** Proposed changes awaiting confirmation. Empty for pure questions. */
  actions: PlannedAction[];
  /** Answer text when the request was a question rather than a change. */
  answer: string | null;
  /** Anything the model wants to flag (couldn't find a client, etc.). */
  note: string | null;
  clients: CommandClient[];
  team: CommandTeamMember[];
};

export type ExecuteResult = {
  id: string;
  ok: boolean;
  message: string;
};

export type ExecuteResponse = {
  results: ExecuteResult[];
  /** True when every action succeeded. */
  ok: boolean;
};

export const PRIORITIES = ["low", "medium", "high"] as const;
export const CATEGORIES = ["work", "billing"] as const;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

// "2026-08-04" -> "Tue, Aug 4". Parsed by hand so the browser timezone
// can't shift it a day (new Date("YYYY-MM-DD") is parsed as UTC).
export function formatDateLong(date: string | null | undefined): string {
  if (!date || !DATE_RE.test(date)) return "—";
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${days[dt.getDay()]}, ${months[dt.getMonth()]} ${dt.getDate()}`;
}

// Local YYYY-MM-DD for a Date — used by the browser to tell the server what
// "today" means before the model resolves "tomorrow" / "next Friday".
export function toLocalDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Fired on `window` after a command is saved so the pages that load their
// data client-side can refetch without a full page reload.
export const CRM_CHANGED_EVENT = "crm:changed";

export function emitCrmChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CRM_CHANGED_EVENT));
  }
}
