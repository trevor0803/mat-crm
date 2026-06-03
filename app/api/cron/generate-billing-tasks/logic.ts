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

// Resolves "today" in Eastern time so the day-of-month comparison and the
// task due_date both reflect the agency's local calendar, regardless of the
// server's timezone.
function easternToday(): { day: number; iso: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const lookup = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const year = lookup("year");
  const month = lookup("month");
  const day = lookup("day");

  return { day: Number(day), iso: `${year}-${month}-${day}` };
}

/**
 * Scans active clients and creates a billing task for any whose bill_date
 * day-of-month matches today (Eastern). Idempotent: skips clients that
 * already have the matching task for today.
 *
 * Throws if the "Trevor" team member is missing — callers map that to a 500.
 */
export async function generateBillingTasks(): Promise<BillingRunResult> {
  const { day, iso } = easternToday();

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
      if (!days.includes(day)) continue;

      const retainer = Math.round(Number(client.retainer)).toLocaleString("en-US");
      const title = `Bill ${client.business_name} $${retainer}`;

      const { rows: existing } = await sql<{ id: number }>`
        SELECT id FROM tasks
        WHERE client_id = ${client.id}
          AND title = ${title}
          AND due_date = ${iso}
        LIMIT 1
      `;
      if (existing.length > 0) {
        skippedDuplicates++;
        continue;
      }

      await sql`
        INSERT INTO tasks (title, due_date, priority, status, client_id, assignee_id)
        VALUES (${title}, ${iso}, 'medium', 'pending', ${client.id}, ${trevorId})
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
    date: iso,
    clientsChecked: clients.length,
    tasksCreated,
    skippedDuplicates,
    errors,
  };
}
