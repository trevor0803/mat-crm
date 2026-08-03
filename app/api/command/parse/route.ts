import { NextRequest, NextResponse } from "next/server";
import { isDateString, type ParseResponse } from "@/lib/command";
import { CommandError, loadCrmContext, parseCommand } from "@/lib/command-server";

export const dynamic = "force-dynamic";
// The Claude round-trip plus two DB queries can exceed the 10s default on
// Vercel's Hobby plan under load.
export const maxDuration = 60;

const MAX_INPUT_CHARS = 2000;

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

// POST /api/command/parse
// body: { text: string, today: "YYYY-MM-DD", weekday?: string }
//
// Read-only. Turns a sentence into a preview plan; nothing is written until
// the same payloads come back to /api/command/execute.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { text, today, weekday } = body as Record<string, unknown>;

    if (typeof text !== "string" || text.trim() === "") {
      return NextResponse.json({ error: "Say or type something first." }, { status: 400 });
    }
    if (text.length > MAX_INPUT_CHARS) {
      return NextResponse.json(
        { error: `That's too long — keep it under ${MAX_INPUT_CHARS} characters.` },
        { status: 400 },
      );
    }

    // Trust the browser's local date so "tomorrow" means tomorrow in the
    // user's timezone, not UTC. Fall back to the server's date if absent.
    const todayStr = isDateString(today) ? today : new Date().toISOString().slice(0, 10);
    const [y, m, d] = todayStr.split("-").map(Number);
    const weekdayStr =
      typeof weekday === "string" && WEEKDAYS.includes(weekday)
        ? weekday
        : WEEKDAYS[new Date(y, m - 1, d).getDay()];

    const ctx = await loadCrmContext();
    const outcome = await parseCommand(text.trim(), todayStr, weekdayStr, ctx);

    const response: ParseResponse = {
      transcript: text.trim(),
      actions: outcome.actions,
      answer: outcome.answer,
      note: outcome.note,
      clients: ctx.clients.map((c) => ({
        id: c.id,
        business_name: c.business_name,
        active: c.active,
      })),
      team: ctx.team,
    };

    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof CommandError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[POST /api/command/parse]", err);
    return NextResponse.json(
      { error: "Something went wrong reading that command." },
      { status: 500 },
    );
  }
}
