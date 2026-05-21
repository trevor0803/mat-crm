import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

type NoteRow = {
  id: number;
  client_id: number;
  note: string;
  created_at: string;
  business_name: string;
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const clientIdParam = url.searchParams.get("client_id");
    const limit = parseLimit(url.searchParams.get("limit"));

    if (clientIdParam !== null) {
      const clientId = Number(clientIdParam);
      if (!Number.isInteger(clientId) || clientId <= 0) {
        return NextResponse.json({ error: "Invalid client_id" }, { status: 400 });
      }
      const { rows } = await sql<NoteRow>`
        SELECT n.id, n.client_id, n.note, n.created_at, c.business_name
        FROM chatter_notes n
        JOIN clients c ON c.id = n.client_id
        WHERE n.client_id = ${clientId}
        ORDER BY n.created_at DESC
        LIMIT ${limit}
      `;
      return NextResponse.json(rows);
    }

    const { rows } = await sql<NoteRow>`
      SELECT n.id, n.client_id, n.note, n.created_at, c.business_name
      FROM chatter_notes n
      JOIN clients c ON c.id = n.client_id
      ORDER BY n.created_at DESC
      LIMIT ${limit}
    `;
    return NextResponse.json(rows);
  } catch (err) {
    console.error("[GET /api/notes]", err);
    return NextResponse.json({ error: "Failed to fetch notes" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { client_id, note } = body as Record<string, unknown>;

    const clientId = typeof client_id === "number" ? client_id : Number(client_id);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return NextResponse.json({ error: "client_id must be a positive integer" }, { status: 400 });
    }
    if (typeof note !== "string" || note.trim() === "") {
      return NextResponse.json({ error: "note must be a non-empty string" }, { status: 400 });
    }

    const trimmed = note.trim();

    const { rows } = await sql<NoteRow>`
      WITH inserted AS (
        INSERT INTO chatter_notes (client_id, note)
        VALUES (${clientId}, ${trimmed})
        RETURNING id, client_id, note, created_at
      )
      SELECT i.id, i.client_id, i.note, i.created_at, c.business_name
      FROM inserted i
      JOIN clients c ON c.id = i.client_id
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23503") {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    console.error("[POST /api/notes]", err);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}
