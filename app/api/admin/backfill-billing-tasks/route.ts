import { NextRequest, NextResponse } from "next/server";
import { runBackfillBillingTasks } from "@/app/api/cron/generate-billing-tasks/logic";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_DAYS_BACK = 7;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const raw = (body as Record<string, unknown> | null)?.daysBack;
  const n = typeof raw === "number" ? raw : Number(raw);
  // runBackfillBillingTasks clamps to 1..30; fall back to a sane default when
  // the caller omits daysBack or sends something non-numeric.
  const daysBack = Number.isFinite(n) ? n : DEFAULT_DAYS_BACK;

  try {
    const result = await runBackfillBillingTasks(daysBack);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/admin/backfill-billing-tasks]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to backfill billing tasks" },
      { status: 500 },
    );
  }
}
