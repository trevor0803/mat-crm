import { sql } from "@/lib/db";
import {
  AD_REVIEW_TITLE,
  AD_REVIEW_ASSIGNEE,
  AD_REVIEW_INTERVAL_DAYS,
} from "@/lib/clients";

type ClientRow = {
  id: number;
  business_name: string;
  ad_review_next_due: string | Date | null;
};

export type AdReviewRunResult = {
  date: string;
  clientsDue: number;
  tasksCreated: number;
  skippedDuplicates: number;
  errors: string[];
};

// Today's calendar date in Eastern time as YYYY-MM-DD, so the weekly cadence
// and task due_date track the agency's local calendar regardless of where the
// cron runs. Mirrors the billing cron's anchor.
function easternTodayISO(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
}

// Adds whole days to a YYYY-MM-DD string and returns YYYY-MM-DD. Pure date
// math anchored at noon UTC so it can never slip across a day boundary.
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12) + days * 86_400_000);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function normalizeDateISO(d: string | Date | null): string | null {
  if (d === null || d === undefined) return null;
  if (d instanceof Date) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return d.slice(0, 10);
}

async function getAdReviewAssigneeId(): Promise<number> {
  const { rows } = await sql<{ id: number }>`
    SELECT id FROM team_members WHERE name = ${AD_REVIEW_ASSIGNEE}
  `;
  if (rows.length === 0) {
    throw new Error(`Team member '${AD_REVIEW_ASSIGNEE}' not found`);
  }
  return rows[0].id;
}

// Creates the ad-review task for one client due on `dueISO` (idempotent), then
// advances ad_review_next_due forward by whole weeks until it is strictly after
// `todayISO` — so a missed cron run never produces a backlog burst, just one
// catch-up task and a re-aligned anchor. Returns whether a task was created.
async function generateForClient(
  client: ClientRow,
  dueISO: string,
  todayISO: string,
  assigneeId: number,
): Promise<{ created: boolean }> {
  const { rows: existing } = await sql<{ id: number }>`
    SELECT id FROM tasks
    WHERE client_id = ${client.id}
      AND title = ${AD_REVIEW_TITLE}
      AND due_date = ${dueISO}
    LIMIT 1
  `;

  let created = false;
  if (existing.length === 0) {
    await sql`
      INSERT INTO tasks (title, due_date, priority, status, category, client_id, assignee_id)
      VALUES (${AD_REVIEW_TITLE}, ${dueISO}, 'medium', 'pending', 'work',
              ${client.id}, ${assigneeId})
    `;
    created = true;
  }

  let next = addDaysISO(dueISO, AD_REVIEW_INTERVAL_DAYS);
  while (next <= todayISO) {
    next = addDaysISO(next, AD_REVIEW_INTERVAL_DAYS);
  }
  await sql`
    UPDATE clients SET ad_review_next_due = ${next} WHERE id = ${client.id}
  `;

  return { created };
}

/**
 * Generates ad-performance review tasks for every enrolled client whose
 * ad_review_next_due has arrived (<= today, Eastern). Idempotent and
 * burst-safe. Throws if the assignee team member is missing.
 */
export async function runAdReviewTasks(): Promise<AdReviewRunResult> {
  const todayISO = easternTodayISO();
  const assigneeId = await getAdReviewAssigneeId();

  const { rows: clients } = await sql<ClientRow>`
    SELECT id, business_name, ad_review_next_due
    FROM clients
    WHERE ad_review_enabled = TRUE
      AND ad_review_next_due IS NOT NULL
      AND ad_review_next_due <= ${todayISO}
    ORDER BY id ASC
  `;

  let tasksCreated = 0;
  let skippedDuplicates = 0;
  const errors: string[] = [];

  for (const client of clients) {
    try {
      const dueISO = normalizeDateISO(client.ad_review_next_due);
      if (!dueISO) continue;
      const { created } = await generateForClient(client, dueISO, todayISO, assigneeId);
      if (created) tasksCreated++;
      else skippedDuplicates++;
    } catch (err) {
      errors.push(
        `Client ${client.id} (${client.business_name}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return {
    date: todayISO,
    clientsDue: clients.length,
    tasksCreated,
    skippedDuplicates,
    errors,
  };
}

/**
 * Enables the recurring ad-review for a single client (the per-account Start
 * button). Anchors next_due to today and immediately generates the first task
 * so it appears right away. Returns the run summary for that client.
 */
export async function startAdReviewForClient(
  clientId: number,
): Promise<{ started: boolean; created: boolean; nextDue: string }> {
  const todayISO = easternTodayISO();
  const assigneeId = await getAdReviewAssigneeId();

  const { rows } = await sql<ClientRow>`
    UPDATE clients
    SET ad_review_enabled = TRUE, ad_review_next_due = ${todayISO}
    WHERE id = ${clientId}
    RETURNING id, business_name, ad_review_next_due
  `;
  if (rows.length === 0) {
    throw new Error("Client not found");
  }

  const { created } = await generateForClient(rows[0], todayISO, todayISO, assigneeId);

  // Re-read the advanced anchor for the response.
  const { rows: after } = await sql<{ ad_review_next_due: string | Date | null }>`
    SELECT ad_review_next_due FROM clients WHERE id = ${clientId}
  `;
  return {
    started: true,
    created,
    nextDue: normalizeDateISO(after[0]?.ad_review_next_due) ?? todayISO,
  };
}

/**
 * Stops the recurring ad-review for a single client (the per-account Stop
 * button). Leaves any already-created open tasks in place; only halts future
 * generation by clearing the enrollment flag and the next-due anchor.
 */
export async function stopAdReviewForClient(clientId: number): Promise<{ stopped: boolean }> {
  const { rowCount } = await sql`
    UPDATE clients
    SET ad_review_enabled = FALSE, ad_review_next_due = NULL
    WHERE id = ${clientId}
  `;
  if (rowCount === 0) {
    throw new Error("Client not found");
  }
  return { stopped: true };
}
