// Smoke test for the Command Box validator/describer. No database or API key
// needed — it feeds a fake CRM context through the same code path the routes
// use. Run with: npx tsx scripts/command.test.ts
import {
  validatePayload,
  describeAction,
  collectPendingClients,
  type CrmContext,
} from "../lib/command-server";
import { isDateString, formatDateLong } from "../lib/command";

const ctx: CrmContext = {
  clients: [
    { id: 7, business_name: "McGrath Plumbing", active: true, retainer: 2500, bill_date: "1" },
    { id: 9, business_name: "Palm Beach Roofing", active: true, retainer: 1800, bill_date: "15" },
  ],
  team: [
    { id: 1, name: "Trevor" },
    { id: 2, name: "Mike" },
  ],
  tasks: [
    {
      id: 42,
      title: "Check landing page",
      due_date: "2026-08-04",
      priority: "medium",
      category: "work",
      business_name: "McGrath Plumbing",
      assignee_name: "Trevor",
    },
  ],
  defaultAssigneeId: 1,
};

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function throws(fn: () => unknown, msg: string) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`expected a rejection: ${msg}`);
}

console.log("validatePayload");

check("create_task resolves client, assignee, due date", () => {
  const p = validatePayload(
    "create_task",
    { title: "Check landing page", client_id: 7, due_date: "2026-08-04" },
    ctx,
  );
  assert(p.title === "Check landing page", "title");
  assert(p.client_id === 7, "client_id");
  assert(p.assignee_id === 1, "should default to Trevor");
  assert(p.due_date === "2026-08-04", "due_date");
  assert(p.priority === "medium", "priority defaults to medium");
  assert(p.category === "work", "category defaults to work");
});

check("create_task honours an explicit assignee", () => {
  const p = validatePayload("create_task", { title: "Ad audit", assignee_id: 2 }, ctx);
  assert(p.assignee_id === 2, "assignee_id");
  assert(p.client_id === null, "no client");
  assert(p.due_date === null, "no due date");
});

check("create_task rejects an empty title", () =>
  throws(() => validatePayload("create_task", { title: "  " }, ctx), "empty title"));

check("create_task rejects an unknown client", () =>
  throws(() => validatePayload("create_task", { title: "x", client_id: 999 }, ctx), "bad client"));

check("create_task rejects an unknown assignee", () =>
  throws(() => validatePayload("create_task", { title: "x", assignee_id: 88 }, ctx), "bad member"));

check("create_task rejects a nonexistent calendar date", () =>
  throws(
    () => validatePayload("create_task", { title: "x", due_date: "2026-02-30" }, ctx),
    "Feb 30",
  ));

check("create_task rejects a non-ISO date", () =>
  throws(() => validatePayload("create_task", { title: "x", due_date: "tomorrow" }, ctx), "prose"));

check("complete_task rejects a task that isn't open", () =>
  throws(() => validatePayload("complete_task", { task_id: 4242 }, ctx), "stale id"));

check("update_task can clear a due date", () => {
  const p = validatePayload("update_task", { task_id: 42, clear_due_date: true }, ctx);
  assert("due_date" in p && p.due_date === null, "due_date cleared");
});

check("update_task rejects a no-op", () =>
  throws(() => validatePayload("update_task", { task_id: 42 }, ctx), "nothing to change"));

check("update_task reassigns", () => {
  const p = validatePayload("update_task", { task_id: 42, assignee_id: 2 }, ctx);
  assert(p.assignee_id === 2, "assignee");
});

check("create_client defaults retainer to 0 and active to true", () => {
  const p = validatePayload("create_client", { business_name: "New Co" }, ctx);
  assert(p.retainer === 0, "retainer");
  assert(p.active === true, "active");
  assert(p.uses_ghl === false, "uses_ghl");
});

check("create_client rejects a negative retainer", () =>
  throws(
    () => validatePayload("create_client", { business_name: "X", retainer: -5 }, ctx),
    "negative retainer",
  ));

check("add_note requires a real client", () =>
  throws(() => validatePayload("add_note", { client_id: 999, note: "hi" }, ctx), "bad client"));

check("add_note rejects empty text", () =>
  throws(() => validatePayload("add_note", { client_id: 7, note: "   " }, ctx), "empty note"));

check("plan_slot rejects an off-grid time", () =>
  throws(
    () => validatePayload("plan_slot", { slot_time: "09:07", title: "x" }, ctx),
    "not a 30-min slot",
  ));

check("plan_slot rejects a time outside 9-5", () =>
  throws(
    () => validatePayload("plan_slot", { slot_time: "18:00", title: "x" }, ctx),
    "after hours",
  ));

check("plan_slot accepts a valid slot", () => {
  const p = validatePayload(
    "plan_slot",
    { slot_time: "13:30", title: "Deep work", energy: "deep", date: "2026-08-04" },
    ctx,
  );
  assert(p.slot_time === "13:30", "slot_time");
  assert(p.energy === "deep", "energy");
});

check("update_client rejects an absurd review interval", () =>
  throws(
    () => validatePayload("update_client", { client_id: 7, ad_review_interval_days: 5000 }, ctx),
    "interval",
  ));

console.log("\nchained: create a client and reference it in the same command");

// "add client Sunrise Dental and note that they came from a referral"
const batch = [
  { kind: "create_client", input: { business_name: "Sunrise Dental", retainer: 3000 } },
  { kind: "add_note", input: { client_name: "Sunrise Dental", note: "Came from a referral." } },
  { kind: "create_task", input: { title: "Send onboarding docs", client_name: "Sunrise Dental" } },
];
const pending = collectPendingClients(batch);

check("collectPendingClients picks up the new business name", () => {
  assert(pending.has("sunrise dental"), "should contain the lowercased name");
  assert(pending.size === 1, "exactly one pending client");
});

check("add_note attaches to a client created in the same command", () => {
  const p = validatePayload("add_note", batch[1].input, ctx, pending);
  assert(p.client_id === null, "no id yet");
  assert(p.new_client_name === "Sunrise Dental", "deferred by name");
  assert(p.note === "Came from a referral.", "note text");
});

check("create_task attaches to a client created in the same command", () => {
  const p = validatePayload("create_task", batch[2].input, ctx, pending);
  assert(p.client_id === null, "no id yet");
  assert(p.new_client_name === "Sunrise Dental", "deferred by name");
});

check("the deferred note preview names the new client", () => {
  const p = validatePayload("add_note", batch[1].input, ctx, pending);
  const d = describeAction("add_note", p, ctx);
  assert(d.summary === "Sunrise Dental (new client)", d.summary);
});

check("a deferred task preview shows the new client, with no 'no client' warning", () => {
  const p = validatePayload("create_task", batch[2].input, ctx, pending);
  const d = describeAction("create_task", p, ctx);
  const flat = d.fields.map((f) => `${f.label}=${f.value}`).join("|");
  assert(flat.includes("Client=Sunrise Dental (new)"), flat);
  assert(!d.warnings.some((w) => w.includes("No client matched")), "should not warn");
});

check("client_name matching an EXISTING client resolves straight to its id", () => {
  const p = validatePayload(
    "add_note",
    { client_name: "mcgrath plumbing", note: "Called them." },
    ctx,
    new Set(),
  );
  assert(p.client_id === 7, "case-insensitive match to the real client");
  assert(p.new_client_name === null, "no deferral needed");
});

check("a name that is neither existing nor pending is rejected", () =>
  throws(
    () => validatePayload("add_note", { client_name: "Ghost Co", note: "x" }, ctx, new Set()),
    "unknown client name",
  ));

check("add_note with no client reference at all is rejected", () =>
  throws(() => validatePayload("add_note", { note: "orphan" }, ctx, new Set()), "no client"));

check("a pending name is NOT accepted when the batch didn't create it", () =>
  throws(
    () =>
      validatePayload("add_note", { client_name: "Sunrise Dental", note: "x" }, ctx, new Set()),
    "not in this batch",
  ));

console.log("\ndescribeAction");

check("create_task preview names the client and assignee", () => {
  const p = validatePayload(
    "create_task",
    { title: "Check landing page", client_id: 7, due_date: "2026-08-04" },
    ctx,
  );
  const d = describeAction("create_task", p, ctx);
  assert(d.summary === "Check landing page", "summary");
  const flat = d.fields.map((f) => `${f.label}=${f.value}`).join("|");
  assert(flat.includes("Client=McGrath Plumbing"), `client field: ${flat}`);
  assert(flat.includes("Assigned to=Trevor"), `assignee field: ${flat}`);
  assert(flat.includes("Due=Tue, Aug 4"), `due field: ${flat}`);
  assert(d.warnings.length === 0, "no warnings expected");
});

check("create_task warns when nothing matched", () => {
  const p = validatePayload("create_task", { title: "Call someone" }, ctx);
  const d = describeAction("create_task", p, ctx);
  assert(d.warnings.length === 2, "expected client + due date warnings");
});

check("delete_task is flagged destructive", () => {
  const p = validatePayload("delete_task", { task_id: 42 }, ctx);
  const d = describeAction("delete_task", p, ctx);
  assert(d.destructive === true, "destructive");
  assert(d.summary === "Check landing page — McGrath Plumbing", `summary: ${d.summary}`);
});

console.log("\ndate helpers");

check("isDateString rejects impossible dates", () => {
  assert(isDateString("2026-08-04"), "valid");
  assert(!isDateString("2026-13-01"), "month 13");
  assert(!isDateString("2025-02-29"), "not a leap year");
  assert(isDateString("2024-02-29"), "leap year");
  assert(!isDateString("8/4/2026"), "US format");
});

check("formatDateLong does not shift across timezones", () => {
  assert(formatDateLong("2026-08-04") === "Tue, Aug 4", formatDateLong("2026-08-04"));
  assert(formatDateLong("2026-01-01") === "Thu, Jan 1", formatDateLong("2026-01-01"));
  assert(formatDateLong(null) === "—", "null");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
