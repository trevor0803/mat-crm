import { NextRequest, NextResponse } from "next/server";
import {
  startAdReviewForClient,
  stopAdReviewForClient,
  setAdReviewIntervalForClient,
} from "@/app/api/cron/generate-ad-review-tasks/logic";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// POST /api/clients/[id]/ad-review
//   { action: "start" | "stop" }                 — enroll / unenroll
//   { action: "set-interval", days: number }     — change how often it repeats
// "start" anchors the schedule to today and creates the first task; "stop"
// halts future generation (existing open tasks are left in place);
// "set-interval" changes the cadence — the already-scheduled next task keeps
// its date, and the new spacing applies from there.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseId(params.id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (action !== "start" && action !== "stop" && action !== "set-interval") {
    return NextResponse.json(
      { error: "action must be 'start', 'stop', or 'set-interval'" },
      { status: 400 },
    );
  }

  try {
    let result;
    if (action === "start") {
      result = await startAdReviewForClient(id);
    } else if (action === "stop") {
      result = await stopAdReviewForClient(id);
    } else {
      result = await setAdReviewIntervalForClient(id, Number(body?.days));
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update ad review";
    const status =
      message === "Client not found" ? 404 : message.startsWith("Interval") ? 400 : 500;
    console.error("[POST /api/clients/[id]/ad-review]", err);
    return NextResponse.json({ error: message }, { status });
  }
}
