import { sql } from "../lib/db";
import {
  addDaysISO,
  runAdReviewTasks,
} from "../app/api/cron/generate-ad-review-tasks/logic";
import { AD_REVIEW_ASSIGNEE } from "../lib/clients";

// Bulk-enroll every active client EXCEPT the names below into the weekly
// ad-performance review, staggering the first-due dates BATCH_SIZE per day so
// the tasks don't all land at once. After enrollment, immediately generate the
// first batch (everything due today); the daily cron creates the rest as their
// dates arrive. Re-running is safe (re-enroll is idempotent; task creation
// dedups on client + title + due_date).
//
//   npm run db:enroll-ad-review -- --dry   # preview only, no writes
//   npm run db:enroll-ad-review            # apply

const BATCH_SIZE = 4;

// Exact business_name spellings as they exist in the DB.
const EXCLUDED = new Set([
  "New Age Builders Group",
  "Silver Hill Coin",
  "Reboot your body now",
  "Get It Done Construction",
  "Stacy Cragg",
  "fitness x 365",
  "Bowie Hockey",
]);

function easternTodayISO(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const lookup = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const today = easternTodayISO();

  const { rows: mike } = await sql<{ id: number }>`
    SELECT id FROM team_members WHERE name = ${AD_REVIEW_ASSIGNEE}
  `;
  if (mike.length === 0) {
    throw new Error(`Assignee '${AD_REVIEW_ASSIGNEE}' not found — create the team member first.`);
  }

  const { rows: clients } = await sql<{ id: number; business_name: string; active: boolean }>`
    SELECT id, business_name, active FROM clients ORDER BY business_name ASC
  `;

  const eligible = clients.filter((c) => !EXCLUDED.has(c.business_name));
  const skipped = clients.filter((c) => EXCLUDED.has(c.business_name));

  console.log(`Today (ET): ${today}`);
  console.log(`Assignee: ${AD_REVIEW_ASSIGNEE} (id ${mike[0].id})`);
  console.log(`\nExcluded (${skipped.length}):`);
  for (const c of skipped) console.log(`  - ${c.business_name}`);

  console.log(`\nEnrolling ${eligible.length} accounts, ${BATCH_SIZE}/day:`);
  const plan = eligible.map((c, i) => {
    const dueDate = addDaysISO(today, Math.floor(i / BATCH_SIZE));
    return { ...c, dueDate };
  });
  for (const p of plan) {
    console.log(`  ${p.dueDate}  ${p.business_name}${p.active ? "" : "  (inactive)"}`);
  }

  if (dryRun) {
    console.log("\n--dry: no changes written.");
    return;
  }

  for (const p of plan) {
    await sql`
      UPDATE clients
      SET ad_review_enabled = TRUE, ad_review_next_due = ${p.dueDate}
      WHERE id = ${p.id}
    `;
  }
  console.log(`\nEnrolled ${plan.length} accounts.`);

  // Create the first batch now (everything due today). The daily cron will
  // pick up the rest on their scheduled days.
  const result = await runAdReviewTasks();
  console.log("\nFirst generation run:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Enrollment failed:", err);
  process.exit(1);
});
