// Server-only half of the Command Box: loads CRM context, asks Claude to turn
// a sentence into structured actions, validates those actions, and runs them.
//
// NEVER import this from a "use client" component — it reads ANTHROPIC_API_KEY
// and talks to Postgres.

import { sql } from "@/lib/db";
import { isValidSlotTime, isValidEnergy, SLOT_TIMES } from "@/lib/planner";
import {
  CATEGORIES,
  PRIORITIES,
  isDateString,
  formatDateLong,
  type CommandActionKind,
  type CommandClient,
  type CommandTeamMember,
  type PlannedAction,
  type PreviewField,
} from "@/lib/command";

// Override in Vercel env vars if you want a cheaper/faster model.
const DEFAULT_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Whoever a task belongs to when the sentence doesn't name anyone.
const DEFAULT_ASSIGNEE_NAME = process.env.COMMAND_DEFAULT_ASSIGNEE ?? "Trevor";

// How many open tasks to show the model. Enough to resolve "mark the McGrath
// landing page one done" without blowing up the prompt.
const TASK_CONTEXT_LIMIT = 250;

/* ------------------------------------------------------------------ *
 * CRM context
 * ------------------------------------------------------------------ */

export type ContextTask = {
  id: number;
  title: string;
  due_date: string | null;
  priority: string;
  category: string;
  business_name: string | null;
  assignee_name: string;
};

export type CrmContext = {
  clients: (CommandClient & { retainer: number; bill_date: string | null })[];
  team: CommandTeamMember[];
  tasks: ContextTask[];
  defaultAssigneeId: number | null;
};

function normalizeDate(d: string | Date | null): string | null {
  if (d === null || d === undefined) return null;
  if (d instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return d.slice(0, 10);
}

export async function loadCrmContext(): Promise<CrmContext> {
  const [clientRes, teamRes, taskRes] = await Promise.all([
    sql<{
      id: number;
      business_name: string;
      active: boolean;
      retainer: string | number;
      bill_date: string | null;
    }>`
      SELECT id, business_name, active, retainer, bill_date
      FROM clients
      ORDER BY business_name ASC
    `,
    sql<{ id: number; name: string }>`
      SELECT id, name FROM team_members WHERE active = TRUE ORDER BY name ASC
    `,
    sql<{
      id: number;
      title: string;
      due_date: string | Date | null;
      priority: string;
      category: string;
      business_name: string | null;
      assignee_name: string;
    }>`
      SELECT t.id, t.title, t.due_date, t.priority, t.category,
             c.business_name, tm.name AS assignee_name
      FROM tasks t
      LEFT JOIN clients c ON c.id = t.client_id
      INNER JOIN team_members tm ON tm.id = t.assignee_id
      WHERE t.status = 'pending'
      ORDER BY t.due_date ASC NULLS LAST, t.created_at ASC
      LIMIT ${TASK_CONTEXT_LIMIT}
    `,
  ]);

  const team = teamRes.rows;
  const defaultMember =
    team.find((m) => m.name.toLowerCase() === DEFAULT_ASSIGNEE_NAME.toLowerCase()) ??
    team[0] ??
    null;

  return {
    clients: clientRes.rows.map((c) => ({
      id: c.id,
      business_name: c.business_name,
      active: c.active,
      retainer: Number(c.retainer),
      bill_date: c.bill_date,
    })),
    team,
    tasks: taskRes.rows.map((t) => ({ ...t, due_date: normalizeDate(t.due_date) })),
    defaultAssigneeId: defaultMember ? defaultMember.id : null,
  };
}

/* ------------------------------------------------------------------ *
 * Tool definitions handed to Claude
 * ------------------------------------------------------------------ */

type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

const TOOLS: AnthropicTool[] = [
  {
    name: "create_task",
    description:
      "Create a new task. Use this for anything phrased as something that needs doing " +
      "(follow up, check, send, call, build, fix, remind me to...).",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "Short imperative title, e.g. 'Check landing page'. Do not put the client " +
            "name, assignee, or due date in the title — those are separate fields.",
        },
        description: { type: "string", description: "Extra detail only if the user gave some." },
        due_date: { type: "string", description: "YYYY-MM-DD. Omit if no due date was stated." },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        category: {
          type: "string",
          enum: ["work", "billing"],
          description: "'billing' only for invoicing/payment tasks. Default 'work'.",
        },
        client_id: { type: "integer", description: "id from the CLIENTS list. Omit if none applies." },
        client_name: {
          type: "string",
          description:
            "Only when the client is being added by a create_client call in this same " +
            "request and therefore has no id yet. Must match that business_name exactly.",
        },
        assignee_id: {
          type: "integer",
          description: "id from the TEAM list. Omit to use the default assignee.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_task",
    description: "Mark an existing open task as done.",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "integer", description: "id from the OPEN TASKS list." } },
      required: ["task_id"],
    },
  },
  {
    name: "update_task",
    description:
      "Change an existing task — reschedule it, reassign it, change its priority, " +
      "rename it, or attach it to a client. Only include the fields that change.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "integer", description: "id from the OPEN TASKS list." },
        title: { type: "string" },
        description: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        clear_due_date: { type: "boolean", description: "true to remove the due date entirely." },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        category: { type: "string", enum: ["work", "billing"] },
        client_id: { type: "integer" },
        assignee_id: { type: "integer" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "delete_task",
    description:
      "Permanently delete a task. Only use when the user clearly says delete/remove/cancel " +
      "the task — prefer complete_task when they say it's finished.",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "integer" } },
      required: ["task_id"],
    },
  },
  {
    name: "create_client",
    description: "Add a new client account to the CRM.",
    input_schema: {
      type: "object",
      properties: {
        business_name: { type: "string" },
        retainer: { type: "number", description: "Monthly retainer in dollars. Use 0 if unknown." },
        bill_date: {
          type: "string",
          description:
            "Day(s) of the month they are billed, slash separated, e.g. '1' or '1/15'.",
        },
        uses_ghl: { type: "boolean", description: "Whether they use GoHighLevel. Default false." },
        billing_method: { type: "string", description: "e.g. PayPal, Stripe, Chase Link." },
        ad_spend_dates: { type: "string" },
      },
      required: ["business_name"],
    },
  },
  {
    name: "update_client",
    description: "Change details on an existing client — retainer, bill date, active status, etc.",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "integer", description: "id from the CLIENTS list." },
        retainer: { type: "number" },
        bill_date: { type: "string" },
        active: { type: "boolean", description: "false to mark the client inactive/churned." },
        billing_method: { type: "string" },
        ad_spend_dates: { type: "string" },
        uses_ghl: { type: "boolean" },
        ad_review_enabled: { type: "boolean" },
        ad_review_interval_days: { type: "integer" },
      },
      required: ["client_id"],
    },
  },
  {
    name: "add_note",
    description:
      "Add a chatter note to a client — an observation, an update, something said on a call. " +
      "Use this when the user is recording information rather than assigning work.",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "integer", description: "id from the CLIENTS list." },
        client_name: {
          type: "string",
          description:
            "Use INSTEAD of client_id when the client is being added by a create_client " +
            "call in this same request and has no id yet. Must match that business_name exactly.",
        },
        note: { type: "string", description: "The note text, lightly cleaned up." },
      },
      required: ["note"],
    },
  },
  {
    name: "plan_slot",
    description:
      "Block time on the daily planner. The planner runs 9:00 AM to 5:00 PM in 30-minute slots.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        slot_time: {
          type: "string",
          description: `24-hour start time, one of: ${SLOT_TIMES.join(", ")}`,
        },
        title: { type: "string" },
        energy: { type: "string", enum: ["deep", "admin", "meeting", "break", "buffer"] },
        task_id: { type: "integer", description: "Link the slot to an open task if one matches." },
      },
      required: ["slot_time", "title"],
    },
  },
];

/* ------------------------------------------------------------------ *
 * Prompt
 * ------------------------------------------------------------------ */

function buildSystemPrompt(ctx: CrmContext, today: string, weekday: string): string {
  const clientLines = ctx.clients
    .map(
      (c) =>
        `  ${c.id} | ${c.business_name}${c.active ? "" : " (inactive)"} | retainer $${c.retainer}` +
        `${c.bill_date ? ` | bills on ${c.bill_date}` : ""}`,
    )
    .join("\n");

  const teamLines = ctx.team.map((m) => `  ${m.id} | ${m.name}`).join("\n");

  const taskLines = ctx.tasks
    .map(
      (t) =>
        `  ${t.id} | ${t.title}` +
        `${t.business_name ? ` | ${t.business_name}` : ""}` +
        ` | ${t.assignee_name}` +
        `${t.due_date ? ` | due ${t.due_date}` : " | no due date"}` +
        ` | ${t.priority}`,
    )
    .join("\n");

  const defaultName =
    ctx.team.find((m) => m.id === ctx.defaultAssigneeId)?.name ?? DEFAULT_ASSIGNEE_NAME;

  return `You are the command bar inside MAT Digital's internal CRM. Trevor runs a digital
marketing agency and talks or types one quick line at you; you turn it into concrete CRM
changes by calling tools.

TODAY IS ${weekday}, ${today}. Resolve all relative dates against this.
  "today" -> ${today}
  "tomorrow" -> the next calendar day
  "next Friday", "end of the month", "in two weeks" -> compute the actual date
Always output dates as YYYY-MM-DD.

CLIENTS (id | name | retainer | bill date)
${clientLines || "  (none yet)"}

TEAM (id | name)
${teamLines || "  (none yet)"}

OPEN TASKS (id | title | client | assignee | due | priority)
${taskLines || "  (none)"}

RULES
1. The input often comes from speech-to-text, so it has no punctuation and business names
   may be garbled ("mcgrath plumbing", "mc grath", "McGraw plumbing"). Match to the closest
   name in the CLIENTS list and use its id. Only skip client_id if nothing is a plausible match.
2. Names of people map to the TEAM list the same way. If no assignee is stated, omit
   assignee_id and it defaults to ${defaultName}.
3. Call one tool per distinct change. "add a task for X and one for Y" is two create_task calls.
4. Never ask a clarifying question. Make the most reasonable call — the user sees a preview
   and confirms before anything is saved, so a decisive guess is more useful than a question.
5. Keep task titles short and imperative. The client, assignee and due date go in their own
   fields, not in the title.
6. If the user is ASKING something rather than requesting a change ("what's due today",
   "how much does McGrath pay us", "who has the most open tasks"), call NO tools and answer
   in plain text from the lists above. Be brief and specific.
7. If part of the request can't be done with the available tools, do the parts you can and
   add one short line of plain text explaining what you skipped.
8. Prefer complete_task over delete_task. Only delete when they explicitly say delete/remove.
9. A client being added right now has no id yet. So for "add client Sunrise Dental and note
   that they came from a referral", call create_client AND add_note, and on the add_note pass
   client_name: "Sunrise Dental" instead of client_id — spelled exactly as in create_client.
   Same for create_task. Never skip the second action just because the id doesn't exist yet.`;
}

/* ------------------------------------------------------------------ *
 * Claude call
 * ------------------------------------------------------------------ */

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: string; [k: string]: unknown };

export class CommandError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function callClaude(
  text: string,
  system: string,
): Promise<{ blocks: ContentBlock[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new CommandError(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local and to the Vercel project.",
      500,
    );
  }

  const model = process.env.COMMAND_MODEL ?? DEFAULT_MODEL;

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system,
        tools: TOOLS,
        messages: [{ role: "user", content: text }],
      }),
    });
  } catch (err) {
    console.error("[command] network error calling Anthropic", err);
    throw new CommandError("Couldn't reach the AI service. Check your connection.", 502);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[command] Anthropic ${res.status}: ${body}`);
    if (res.status === 401) {
      throw new CommandError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.", 500);
    }
    if (res.status === 404) {
      throw new CommandError(
        `The model "${model}" isn't available on this API key. Set COMMAND_MODEL to one you have access to.`,
        500,
      );
    }
    if (res.status === 429) {
      throw new CommandError("Rate limited by the AI service. Try again in a moment.", 429);
    }
    if (res.status === 400) {
      throw new CommandError(
        "The AI service rejected the request — check COMMAND_MODEL is a valid model name.",
        502,
      );
    }
    throw new CommandError(`AI service error (${res.status}). Try again.`, 502);
  }

  const data = (await res.json()) as { content?: ContentBlock[] };
  return { blocks: Array.isArray(data.content) ? data.content : [] };
}

/* ------------------------------------------------------------------ *
 * Validation — shared by planning and execution
 * ------------------------------------------------------------------ */

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function asInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function asBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export type CleanPayload = Record<string, unknown>;

// Lowercased business names of clients being created in the same batch, so a
// note or task in the same sentence can attach to a client that doesn't have
// an id yet. Built by collectPendingClients().
export type PendingClients = Set<string>;

export function collectPendingClients(
  items: Array<{ kind: string; payload?: unknown; input?: unknown }>,
): PendingClients {
  const out: PendingClients = new Set();
  for (const item of items) {
    if (item.kind !== "create_client") continue;
    const src = (item.payload ?? item.input) as Record<string, unknown> | undefined;
    const name = src && typeof src.business_name === "string" ? src.business_name.trim() : "";
    if (name) out.add(name.toLowerCase());
  }
  return out;
}

// Validates a payload against the live CRM context. Throws CommandError with a
// human-readable message on anything invalid. Run at plan time AND again at
// execute time, so a tampered or stale payload can never reach the database.
export function validatePayload(
  kind: CommandActionKind,
  raw: unknown,
  ctx: CrmContext,
  pendingClients: PendingClients = new Set(),
): CleanPayload {
  if (!raw || typeof raw !== "object") throw new CommandError("Malformed action payload.");
  const p = raw as Record<string, unknown>;

  // Resolves a client reference that may point at a client being created in
  // the same batch. Returns the id, or the pending name to resolve at execute.
  const resolveClientRef = (): { client_id: number | null; new_client_name: string | null } => {
    if (p.client_id !== undefined && p.client_id !== null && p.client_id !== "") {
      const id = asInt(p.client_id);
      if (id === null || !ctx.clients.some((c) => c.id === id)) {
        throw new CommandError("Unknown client.");
      }
      return { client_id: id, new_client_name: null };
    }
    const name = asString(p.client_name) ?? asString(p.new_client_name);
    if (name) {
      // Might already exist under a slightly different id lookup.
      const existing = ctx.clients.find(
        (c) => c.business_name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) return { client_id: existing.id, new_client_name: null };
      if (pendingClients.has(name.toLowerCase())) {
        return { client_id: null, new_client_name: name };
      }
      throw new CommandError(`No client called "${name}" — add them first.`);
    }
    return { client_id: null, new_client_name: null };
  };

  const clientIds = new Set(ctx.clients.map((c) => c.id));
  const teamIds = new Set(ctx.team.map((m) => m.id));
  const taskIds = new Set(ctx.tasks.map((t) => t.id));

  const requireClient = (v: unknown, label = "client") => {
    const id = asInt(v);
    if (id === null || !clientIds.has(id)) throw new CommandError(`Unknown ${label}.`);
    return id;
  };
  const requireTask = (v: unknown) => {
    const id = asInt(v);
    if (id === null || !taskIds.has(id)) {
      throw new CommandError("That task is no longer open — it may have been changed already.");
    }
    return id;
  };

  switch (kind) {
    case "create_task": {
      const title = asString(p.title);
      if (!title) throw new CommandError("A task needs a title.");

      const assigneeId = asInt(p.assignee_id) ?? ctx.defaultAssigneeId;
      if (assigneeId === null || !teamIds.has(assigneeId)) {
        throw new CommandError("Pick a team member to assign this to.");
      }

      const clientRef = resolveClientRef();

      const dueRaw = p.due_date;
      let dueDate: string | null = null;
      if (dueRaw !== undefined && dueRaw !== null && dueRaw !== "") {
        if (!isDateString(dueRaw)) throw new CommandError("Due date must be a real YYYY-MM-DD date.");
        dueDate = dueRaw;
      }

      return {
        title: title.slice(0, 300),
        description: asString(p.description),
        due_date: dueDate,
        priority: oneOf(p.priority, PRIORITIES) ?? "medium",
        category: oneOf(p.category, CATEGORIES) ?? "work",
        client_id: clientRef.client_id,
        new_client_name: clientRef.new_client_name,
        assignee_id: assigneeId,
      };
    }

    case "complete_task":
    case "delete_task":
      return { task_id: requireTask(p.task_id) };

    case "update_task": {
      const out: CleanPayload = { task_id: requireTask(p.task_id) };
      const title = asString(p.title);
      if (title) out.title = title.slice(0, 300);
      if (typeof p.description === "string") out.description = asString(p.description);
      if (p.clear_due_date === true) {
        out.due_date = null;
      } else if (p.due_date !== undefined && p.due_date !== null && p.due_date !== "") {
        if (!isDateString(p.due_date)) throw new CommandError("Due date must be YYYY-MM-DD.");
        out.due_date = p.due_date;
      }
      const priority = oneOf(p.priority, PRIORITIES);
      if (priority) out.priority = priority;
      const category = oneOf(p.category, CATEGORIES);
      if (category) out.category = category;
      if (p.assignee_id !== undefined && p.assignee_id !== null) {
        const id = asInt(p.assignee_id);
        if (id === null || !teamIds.has(id)) throw new CommandError("Unknown team member.");
        out.assignee_id = id;
      }
      if (p.client_id !== undefined && p.client_id !== null) {
        out.client_id = p.client_id === "" ? null : requireClient(p.client_id);
      }
      if (Object.keys(out).length === 1) throw new CommandError("Nothing to change on that task.");
      return out;
    }

    case "create_client": {
      const name = asString(p.business_name);
      if (!name) throw new CommandError("A client needs a business name.");
      const retainerRaw = p.retainer;
      const retainer =
        retainerRaw === undefined || retainerRaw === null || retainerRaw === ""
          ? 0
          : Number(retainerRaw);
      if (!Number.isFinite(retainer) || retainer < 0) {
        throw new CommandError("Retainer must be a positive number.");
      }
      return {
        business_name: name.slice(0, 200),
        retainer,
        bill_date: asString(p.bill_date),
        uses_ghl: asBool(p.uses_ghl) ?? false,
        billing_method: asString(p.billing_method),
        ad_spend_dates: asString(p.ad_spend_dates),
        active: asBool(p.active) ?? true,
      };
    }

    case "update_client": {
      const out: CleanPayload = { client_id: requireClient(p.client_id) };
      if (p.retainer !== undefined && p.retainer !== null && p.retainer !== "") {
        const n = Number(p.retainer);
        if (!Number.isFinite(n) || n < 0) throw new CommandError("Retainer must be a positive number.");
        out.retainer = n;
      }
      if (p.bill_date !== undefined) out.bill_date = asString(p.bill_date);
      if (p.billing_method !== undefined) out.billing_method = asString(p.billing_method);
      if (p.ad_spend_dates !== undefined) out.ad_spend_dates = asString(p.ad_spend_dates);
      const active = asBool(p.active);
      if (active !== null) out.active = active;
      const usesGhl = asBool(p.uses_ghl);
      if (usesGhl !== null) out.uses_ghl = usesGhl;
      const adReview = asBool(p.ad_review_enabled);
      if (adReview !== null) out.ad_review_enabled = adReview;
      if (p.ad_review_interval_days !== undefined && p.ad_review_interval_days !== null) {
        const n = asInt(p.ad_review_interval_days);
        if (n === null || n > 365) throw new CommandError("Review interval must be 1–365 days.");
        out.ad_review_interval_days = n;
      }
      if (Object.keys(out).length === 1) throw new CommandError("Nothing to change on that client.");
      return out;
    }

    case "add_note": {
      const note = asString(p.note);
      if (!note) throw new CommandError("The note is empty.");
      const ref = resolveClientRef();
      if (ref.client_id === null && ref.new_client_name === null) {
        throw new CommandError("Which client is this note for?");
      }
      return {
        client_id: ref.client_id,
        new_client_name: ref.new_client_name,
        note: note.slice(0, 5000),
      };
    }

    case "plan_slot": {
      if (!isValidSlotTime(p.slot_time)) {
        throw new CommandError("The planner only has 30-minute slots from 9:00 AM to 5:00 PM.");
      }
      const title = asString(p.title);
      if (!title) throw new CommandError("A planner block needs a title.");
      if (p.date !== undefined && p.date !== null && !isDateString(p.date)) {
        throw new CommandError("Planner date must be YYYY-MM-DD.");
      }
      let taskId: number | null = null;
      if (p.task_id !== undefined && p.task_id !== null && p.task_id !== "") {
        taskId = requireTask(p.task_id);
      }
      return {
        date: (p.date as string) ?? null,
        slot_time: p.slot_time,
        title: title.slice(0, 300),
        energy: isValidEnergy(p.energy) ? p.energy : null,
        task_id: taskId,
      };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Preview cards
 * ------------------------------------------------------------------ */

const KIND_TITLES: Record<CommandActionKind, string> = {
  create_task: "Add task",
  complete_task: "Mark done",
  update_task: "Update task",
  delete_task: "Delete task",
  create_client: "Add client",
  update_client: "Update client",
  add_note: "Add note",
  plan_slot: "Block time",
};

function clientName(ctx: CrmContext, id: unknown): string {
  const c = ctx.clients.find((x) => x.id === id);
  return c ? c.business_name : "—";
}

function memberName(ctx: CrmContext, id: unknown): string {
  const m = ctx.team.find((x) => x.id === id);
  return m ? m.name : "—";
}

function taskLabel(ctx: CrmContext, id: unknown): string {
  const t = ctx.tasks.find((x) => x.id === id);
  if (!t) return `task #${String(id)}`;
  return t.business_name ? `${t.title} — ${t.business_name}` : t.title;
}

function slotLabel(slot: string): string {
  const [h, m] = slot.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function describeAction(
  kind: CommandActionKind,
  payload: CleanPayload,
  ctx: CrmContext,
): { summary: string; fields: PreviewField[]; warnings: string[]; destructive: boolean } {
  const warnings: string[] = [];
  const fields: PreviewField[] = [];

  switch (kind) {
    case "create_task": {
      const cid = payload.client_id as number | null;
      const pendingName = payload.new_client_name as string | null;
      fields.push({
        label: "Client",
        value: cid ? clientName(ctx, cid) : pendingName ? `${pendingName} (new)` : "None",
      });
      fields.push({ label: "Assigned to", value: memberName(ctx, payload.assignee_id) });
      fields.push({ label: "Due", value: formatDateLong(payload.due_date as string | null) });
      fields.push({ label: "Priority", value: String(payload.priority) });
      if (payload.category === "billing") fields.push({ label: "Category", value: "Billing" });
      if (payload.description) {
        fields.push({ label: "Notes", value: String(payload.description) });
      }
      if (!cid && !pendingName) {
        warnings.push("No client matched — this task won't be linked to an account.");
      }
      if (!payload.due_date) warnings.push("No due date was given.");
      return {
        summary: String(payload.title),
        fields,
        warnings,
        destructive: false,
      };
    }

    case "complete_task":
      return {
        summary: taskLabel(ctx, payload.task_id),
        fields: [{ label: "New status", value: "Done" }],
        warnings: [],
        destructive: false,
      };

    case "delete_task":
      return {
        summary: taskLabel(ctx, payload.task_id),
        fields: [],
        warnings: ["This permanently deletes the task. It can't be undone."],
        destructive: true,
      };

    case "update_task": {
      if ("title" in payload) fields.push({ label: "New title", value: String(payload.title) });
      if ("due_date" in payload) {
        fields.push({
          label: "Due",
          value: payload.due_date ? formatDateLong(payload.due_date as string) : "Cleared",
        });
      }
      if ("assignee_id" in payload) {
        fields.push({ label: "Assigned to", value: memberName(ctx, payload.assignee_id) });
      }
      if ("client_id" in payload) {
        fields.push({
          label: "Client",
          value: payload.client_id ? clientName(ctx, payload.client_id) : "None",
        });
      }
      if ("priority" in payload) fields.push({ label: "Priority", value: String(payload.priority) });
      if ("category" in payload) fields.push({ label: "Category", value: String(payload.category) });
      if ("description" in payload) {
        fields.push({ label: "Notes", value: String(payload.description ?? "Cleared") });
      }
      return { summary: taskLabel(ctx, payload.task_id), fields, warnings, destructive: false };
    }

    case "create_client": {
      fields.push({ label: "Retainer", value: `$${Number(payload.retainer).toLocaleString("en-US")}` });
      fields.push({ label: "Bills on", value: (payload.bill_date as string) ?? "—" });
      fields.push({ label: "Billing method", value: (payload.billing_method as string) ?? "—" });
      fields.push({ label: "Uses GHL", value: payload.uses_ghl ? "Yes" : "No" });
      if (!payload.retainer) warnings.push("Retainer is $0 — set it on the client page if that's wrong.");
      return { summary: String(payload.business_name), fields, warnings, destructive: false };
    }

    case "update_client": {
      if ("retainer" in payload) {
        fields.push({
          label: "Retainer",
          value: `$${Number(payload.retainer).toLocaleString("en-US")}`,
        });
      }
      if ("bill_date" in payload) fields.push({ label: "Bills on", value: (payload.bill_date as string) ?? "—" });
      if ("billing_method" in payload) {
        fields.push({ label: "Billing method", value: (payload.billing_method as string) ?? "—" });
      }
      if ("ad_spend_dates" in payload) {
        fields.push({ label: "Ad spend dates", value: (payload.ad_spend_dates as string) ?? "—" });
      }
      if ("active" in payload) fields.push({ label: "Active", value: payload.active ? "Yes" : "No" });
      if ("uses_ghl" in payload) fields.push({ label: "Uses GHL", value: payload.uses_ghl ? "Yes" : "No" });
      if ("ad_review_enabled" in payload) {
        fields.push({ label: "Ad reviews", value: payload.ad_review_enabled ? "On" : "Off" });
      }
      if ("ad_review_interval_days" in payload) {
        fields.push({ label: "Review every", value: `${payload.ad_review_interval_days} days` });
      }
      if (payload.active === false) warnings.push("Marking a client inactive hides them from billing.");
      return { summary: clientName(ctx, payload.client_id), fields, warnings, destructive: false };
    }

    case "add_note": {
      const pendingName = payload.new_client_name as string | null;
      return {
        summary: pendingName
          ? `${pendingName} (new client)`
          : clientName(ctx, payload.client_id),
        fields: [{ label: "Note", value: String(payload.note) }],
        warnings: [],
        destructive: false,
      };
    }

    case "plan_slot": {
      fields.push({ label: "Time", value: slotLabel(String(payload.slot_time)) });
      fields.push({
        label: "Date",
        value: payload.date ? formatDateLong(payload.date as string) : "Today",
      });
      if (payload.energy) fields.push({ label: "Type", value: String(payload.energy) });
      if (payload.task_id) fields.push({ label: "Linked task", value: taskLabel(ctx, payload.task_id) });
      warnings.push("This replaces whatever is already in that slot.");
      return { summary: String(payload.title), fields, warnings, destructive: false };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Parse: sentence -> preview plan
 * ------------------------------------------------------------------ */

export type ParseOutcome = {
  actions: PlannedAction[];
  answer: string | null;
  note: string | null;
};

export async function parseCommand(
  text: string,
  today: string,
  weekday: string,
  ctx: CrmContext,
): Promise<ParseOutcome> {
  const system = buildSystemPrompt(ctx, today, weekday);
  const { blocks } = await callClaude(text, system);

  const toolBlocks = blocks.filter(
    (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
      b.type === "tool_use",
  );
  const textBlocks = blocks.filter(
    (b): b is { type: "text"; text: string } => b.type === "text",
  );
  const modelText = textBlocks.map((b) => b.text.trim()).filter(Boolean).join("\n\n") || null;

  const actions: PlannedAction[] = [];
  const problems: string[] = [];

  // Clients being added by this same command have no id yet, so notes and
  // tasks in the same sentence reference them by name instead.
  const pendingClients = collectPendingClients(
    toolBlocks.map((b) => ({ kind: b.name, input: b.input })),
  );

  for (let i = 0; i < toolBlocks.length; i++) {
    const block = toolBlocks[i];
    const kind = block.name as CommandActionKind;
    if (!(kind in KIND_TITLES)) continue;

    // plan_slot defaults to today when no date was stated.
    const input = { ...block.input };
    if (kind === "plan_slot" && !input.date) input.date = today;

    try {
      const payload = validatePayload(kind, input, ctx, pendingClients);
      const described = describeAction(kind, payload, ctx);
      actions.push({
        id: `${kind}-${i}-${block.id ?? i}`,
        kind,
        title: KIND_TITLES[kind],
        summary: described.summary,
        fields: described.fields,
        warnings: described.warnings,
        destructive: described.destructive,
        payload,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not build that action.";
      problems.push(`${KIND_TITLES[kind] ?? kind}: ${msg}`);
    }
  }

  const note =
    problems.length > 0
      ? [modelText, ...problems].filter(Boolean).join("\n")
      : actions.length > 0
        ? modelText
        : null;

  return {
    actions,
    answer: actions.length === 0 && problems.length === 0 ? modelText : null,
    note,
  };
}

/* ------------------------------------------------------------------ *
 * Execute: preview plan -> database writes
 * ------------------------------------------------------------------ */

// Names (lowercased) of clients inserted earlier in this same batch, mapped to
// the ids Postgres gave them. Lets "add client X and note Y about them" work.
export type CreatedClients = Map<string, number>;

function resolveBatchClientId(
  payload: CleanPayload,
  createdClients: CreatedClients,
): number | null {
  if (typeof payload.client_id === "number") return payload.client_id;
  const pending = payload.new_client_name;
  if (typeof pending === "string" && pending !== "") {
    const id = createdClients.get(pending.toLowerCase());
    if (id === undefined) {
      throw new CommandError(
        `Couldn't link to "${pending}" — that client wasn't created, so this was skipped.`,
      );
    }
    return id;
  }
  return null;
}

export async function executeAction(
  kind: CommandActionKind,
  payload: CleanPayload,
  ctx: CrmContext,
  createdClients: CreatedClients = new Map(),
): Promise<string> {
  switch (kind) {
    case "create_task": {
      const clientId = resolveBatchClientId(payload, createdClients);
      await sql`
        INSERT INTO tasks (title, description, due_date, priority, category, client_id, assignee_id)
        VALUES (${payload.title as string}, ${payload.description as string | null},
                ${payload.due_date as string | null}, ${payload.priority as string},
                ${payload.category as string}, ${clientId},
                ${payload.assignee_id as number})
      `;
      return `Added "${payload.title}"`;
    }

    case "complete_task": {
      const { rowCount } = await sql`
        UPDATE tasks SET status = 'done', completed_at = NOW()
        WHERE id = ${payload.task_id as number} AND status = 'pending'
      `;
      if (!rowCount) return "That task was already done.";
      return `Marked "${taskLabel(ctx, payload.task_id)}" done`;
    }

    case "delete_task": {
      const label = taskLabel(ctx, payload.task_id);
      await sql`DELETE FROM tasks WHERE id = ${payload.task_id as number}`;
      return `Deleted "${label}"`;
    }

    case "update_task": {
      const id = payload.task_id as number;
      const sets: string[] = [];
      const values: unknown[] = [];
      const push = (col: string, val: unknown) => {
        values.push(val);
        sets.push(`${col} = $${values.length}`);
      };
      if ("title" in payload) push("title", payload.title);
      if ("description" in payload) push("description", payload.description);
      if ("due_date" in payload) push("due_date", payload.due_date);
      if ("priority" in payload) push("priority", payload.priority);
      if ("category" in payload) push("category", payload.category);
      if ("client_id" in payload) push("client_id", payload.client_id);
      if ("assignee_id" in payload) push("assignee_id", payload.assignee_id);
      if (sets.length === 0) return "Nothing to change.";
      values.push(id);
      await sql.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
      return `Updated "${taskLabel(ctx, id)}"`;
    }

    case "create_client": {
      const name = payload.business_name as string;
      try {
        const { rows } = await sql<{ id: number }>`
          INSERT INTO clients
            (business_name, uses_ghl, retainer, bill_date, active, billing_method, ad_spend_dates)
          VALUES
            (${name}, ${payload.uses_ghl as boolean},
             ${payload.retainer as number}, ${payload.bill_date as string | null},
             ${payload.active as boolean}, ${payload.billing_method as string | null},
             ${payload.ad_spend_dates as string | null})
          RETURNING id
        `;
        // Let later actions in this batch attach to the client we just made.
        if (rows[0]) createdClients.set(name.toLowerCase(), rows[0].id);
      } catch (err) {
        if ((err as { code?: string })?.code === "23505") {
          throw new CommandError(`"${payload.business_name}" already exists in the CRM.`);
        }
        throw err;
      }
      return `Added client "${payload.business_name}"`;
    }

    case "update_client": {
      const id = payload.client_id as number;
      const sets: string[] = [];
      const values: unknown[] = [];
      const push = (col: string, val: unknown) => {
        values.push(val);
        sets.push(`${col} = $${values.length}`);
      };
      if ("retainer" in payload) push("retainer", payload.retainer);
      if ("bill_date" in payload) push("bill_date", payload.bill_date);
      if ("billing_method" in payload) push("billing_method", payload.billing_method);
      if ("ad_spend_dates" in payload) push("ad_spend_dates", payload.ad_spend_dates);
      if ("active" in payload) push("active", payload.active);
      if ("uses_ghl" in payload) push("uses_ghl", payload.uses_ghl);
      if ("ad_review_enabled" in payload) push("ad_review_enabled", payload.ad_review_enabled);
      if ("ad_review_interval_days" in payload) {
        push("ad_review_interval_days", payload.ad_review_interval_days);
      }
      if (sets.length === 0) return "Nothing to change.";
      values.push(id);
      await sql.query(`UPDATE clients SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
      return `Updated ${clientName(ctx, id)}`;
    }

    case "add_note": {
      const clientId = resolveBatchClientId(payload, createdClients);
      if (clientId === null) throw new CommandError("That note has no client to attach to.");
      await sql`
        INSERT INTO chatter_notes (client_id, note)
        VALUES (${clientId}, ${payload.note as string})
      `;
      const label =
        clientName(ctx, clientId) === "—"
          ? (payload.new_client_name as string)
          : clientName(ctx, clientId);
      return `Noted on ${label}`;
    }

    case "plan_slot": {
      const date = (payload.date as string | null) ?? null;
      if (!date) throw new CommandError("Planner block is missing a date.");
      await sql`
        INSERT INTO planner_slots (plan_date, slot_time, title, task_id, energy, done)
        VALUES (${date}, ${payload.slot_time as string}, ${payload.title as string},
                ${payload.task_id as number | null}, ${payload.energy as string | null}, FALSE)
        ON CONFLICT (plan_date, slot_time) DO UPDATE
          SET title = EXCLUDED.title,
              task_id = EXCLUDED.task_id,
              energy = EXCLUDED.energy,
              updated_at = NOW()
      `;
      return `Blocked ${slotLabel(String(payload.slot_time))} for "${payload.title}"`;
    }
  }
}
