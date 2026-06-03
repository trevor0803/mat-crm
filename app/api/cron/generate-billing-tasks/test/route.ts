import { NextResponse } from "next/server";
import { runDailyBillingTasks } from "../logic";

export const runtime = "nodejs";
export const maxDuration = 60;
// Prevent Next from invoking this DB-touching handler during the build's
// static-generation pass.
export const dynamic = "force-dynamic";

// Unauthenticated convenience endpoint for local development only. Runs the
// exact same logic as the cron route but skips the CRON_SECRET check. Disabled
// on Production so it can never be hit against the live deploy.
export async function GET() {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  try {
    const result = await runDailyBillingTasks();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[GET /api/cron/generate-billing-tasks/test]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate billing tasks" },
      { status: 500 },
    );
  }
}
