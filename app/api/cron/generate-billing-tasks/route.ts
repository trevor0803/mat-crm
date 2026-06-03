import { NextRequest, NextResponse } from "next/server";
import { runDailyBillingTasks } from "./logic";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDailyBillingTasks();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[GET /api/cron/generate-billing-tasks]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate billing tasks" },
      { status: 500 },
    );
  }
}
