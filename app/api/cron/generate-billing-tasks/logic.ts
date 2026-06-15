import { sql } from "@/lib/db";
import { parseBillDays } from "@/lib/clients";

type ClientRow = {
  id: number;
  business_name: string;
  retainer: string | number;
  bill_date: string | null;
};

export type BillingRunResult = {
  date: string;
  clientsChecked: number;
  tasksCreated: number;
  skippedDuplicates: number;
  errors: string[];
};

export type BackfillRunResult = {
  startDate: string;
  endDate: string;
  daysProcessed: number;
  totalCreated: number;
  totalSkipped: number;
  totalErrors: number;
  days: BillingRunResult[];
};

// Today's calendar date in Eastern time as a YYYY-MM-DD string, so the
// day-of-month comparison and task due_date reflect the agency's local
// calendar regardless of the server's timezone.
function easternTodayISO(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const lookup = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
}

function dayOfMonthFromISO(iso: string): number {
  return Number(iso.slice(8, 10));
}

// Enumerates the calendar dates from (today - daysBack + 1) through today in
// Eastern time, oldest first. Day arithmetic is anchored at noon UTC so DST
// transitions can never bump a date across midnight.
function easternDateRange(daysBack: number): string[] {
  const todayISO = easternTodayISO();
  const [y, m, d] = todayISO.split("-").map(Number);
  const anchor = Date.UTC(y, m - 1, d, 12);

  const out: string[] = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const dt = new Date(anchor - i * 86_400_000);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    out.push(`${yy}-${mm}-${dd}`);
  }
  return out;
}

/**
 * Scans active clients and creates a billing task (due on the given date) for
 * any whose bill_date day-of-month matches dayOfMonth. Idempotent: skips
 * clients that already have the matching task for that date.
 *
 * Throws if the "Trevor" team member is missing — callers map that to a 500.
 */
export async function processDayForBilling(
  dateISO: string,
  dayOfMonth: number,
): Promise<BillingRunResult> {
  const { rows: trevorRows } = await sql<{ id: number }>`
    SELECT id FROM team_members WHERE name = 'Trevor'
  `;
  if (trevorRows.length === 0) {
    throw new Error("Team member 'Trevor' not found");
  }
  const trevorId = trevorRows[0].id;

  const { rows: clients } = await sql<ClientRow>`
    SELECT id, business_name, retainer, bill_date
    FROM clients
    WHERE active = TRUE AND bill_date IS NOT NULL
  `;

  let tasksCreated = 0;
  let skippedDuplicates = 0;
  const errors: string[] = [];

  for (const client of clients) {
    try {
      const days = parseBillDays(client.bill_date);
      if (!days.includes(dayOfMonth)) continue;

      const retainer = Math.round(Number(client.retainer)).toLocaleString("en-US");
      const title = `Bill ${client.business_name} $${retainer}`;

      const { rows: existing } = await sql<{ id: number }>`
        SELECT id FROM tasks
        WHERE client_id = ${client.id}
          AND title = ${title}
          AND due_date = ${dateISO}
        LIMIT 1
      `;
      if (existing.length > 0) {
        skippedDuplicates++;
        continue;
      }

      await sql`
        INSERT INTO tasks (title, due_date, priority, status, category, client_id, assignee_id)
        VALUES (${title}, ${dateISO}, 'medium', 'pending', 'billing', ${client.id}, ${trevorId})
      `;
      tasksCreated++;
    } catch (err) {
      errors.push(
        `Client ${client.id} (${client.business_name}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return {
    date: dateISO,
    clientsChecked: clients.length,
    tasksCreated,
    skippedDuplicates,
    errors,
  };
}

/**
 * Generates billing tasks for today (Eastern). This is what the daily cron
 * invokes.
 */
export async function runDailyBillingTasks(): Promise<BillingRunResult> {
  const iso = easternTodayISO();
  return processDayForBilling(iso, dayOfMonthFromISO(iso));
}

/**
 * Retroactively generates billing tasks for the last `daysBack` days
 * (clamped to 1..30), inclusive of today, processed oldest-first. Each day's
 * tasks are due on that day so backfilled tasks correctly read as overdue.
 */
export async function runBackfillBillingTasks(
  daysBack: number,
): Promise<BackfillRunResult> {
  const clamped = Math.min(30, Math.max(1, Math.trunc(daysBack)));
  const dates = easternDateRange(clamped);

  const days: BillingRunResult[] = [];
  for (const iso of dates) {
    days.push(await processDayForBilling(iso, dayOfMonthFromISO(iso)));
  }

  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    daysProcessed: days.length,
    totalCreated: days.reduce((sum, d) => sum + d.tasksCreated, 0),
    totalSkipped: days.reduce((sum, d) => sum + d.skippedDuplicates, 0),
    totalErrors: days.reduce((sum, d) => sum + d.errors.length, 0),
    days,
  };
}
