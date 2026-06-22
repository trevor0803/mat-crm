import { NextRequest, NextResponse } from "next/server";
import {
  startAdReviewForClient,
  stopAdReviewForClient,
} from "@/app/api/cron/generate-ad-review-tasks/logic";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// POST /api/clients/[id]/ad-review  { action: "start" | "stop" }
// Starts or stops the recurring weekly ad-performance review task for one
// client. "start" anchors the schedule to today and creates the first task;
// "stop" halts future generation (existing open tasks are left in place).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseId(params.id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const action = (body as Record<string, unknown> | null)?.action;
  if (action !== "start" && action !== "stop") {
    return NextResponse.json(
      { error: "action must be 'start' or 'stop'" },
      { status: 400 },
    );
  }

  try {
    const result =
      action === "start"
        ? await startAdReviewForClient(id)
        : await stopAdReviewForClient(id);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update ad review";
    const status = message === "Client not found" ? 404 : 500;
    console.error("[POST /api/clients/[id]/ad-review]", err);
    return NextResponse.json({ error: message }, { status });
  }
}
