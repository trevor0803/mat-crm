import { NextRequest, NextResponse } from "next/server";
import {
  isCommandActionKind,
  type ExecuteResponse,
  type ExecuteResult,
} from "@/lib/command";
import {
  CommandError,
  collectPendingClients,
  executeAction,
  loadCrmContext,
  validatePayload,
  type CreatedClients,
} from "@/lib/command-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ACTIONS = 20;

// POST /api/command/execute
// body: { actions: [{ id, kind, payload }] }
//
// Every payload is re-validated against freshly loaded CRM state before it
// touches the database — the preview the browser saw is never trusted on its
// own, and the user may have edited fields on the preview card.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { actions } = body as Record<string, unknown>;
    if (!Array.isArray(actions) || actions.length === 0) {
      return NextResponse.json({ error: "No actions to save." }, { status: 400 });
    }
    if (actions.length > MAX_ACTIONS) {
      return NextResponse.json(
        { error: `Too many actions at once (max ${MAX_ACTIONS}).` },
        { status: 400 },
      );
    }

    const ctx = await loadCrmContext();
    const results: ExecuteResult[] = [];

    // A note or task can reference a client created by this same batch, so
    // every create_client has to run first and hand its new id downstream.
    const ordered = [...actions].sort((a, b) => {
      const rank = (x: unknown) =>
        x && typeof x === "object" && (x as { kind?: unknown }).kind === "create_client" ? 0 : 1;
      return rank(a) - rank(b);
    });
    const pendingClients = collectPendingClients(
      ordered.filter(
        (a): a is { kind: string; payload?: unknown } => Boolean(a) && typeof a === "object",
      ),
    );
    const createdClients: CreatedClients = new Map();

    for (let i = 0; i < ordered.length; i++) {
      const raw = ordered[i];
      const id =
        raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string"
          ? (raw as { id: string }).id
          : `action-${i}`;

      if (!raw || typeof raw !== "object") {
        results.push({ id, ok: false, message: "Malformed action." });
        continue;
      }

      const { kind, payload } = raw as { kind?: unknown; payload?: unknown };
      if (!isCommandActionKind(kind)) {
        results.push({ id, ok: false, message: "Unknown action type." });
        continue;
      }

      try {
        const clean = validatePayload(kind, payload, ctx, pendingClients);
        const message = await executeAction(kind, clean, ctx, createdClients);
        results.push({ id, ok: true, message });
      } catch (err) {
        const message =
          err instanceof CommandError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to save.";
        if (!(err instanceof CommandError)) {
          console.error("[POST /api/command/execute] action failed", err);
        }
        results.push({ id, ok: false, message });
      }
    }

    const response: ExecuteResponse = {
      results,
      ok: results.every((r) => r.ok),
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("[POST /api/command/execute]", err);
    return NextResponse.json({ error: "Failed to save those changes." }, { status: 500 });
  }
}
