import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

type NoteRow = {
  id: number;
  client_id: number;
  note: string;
  created_at: string;
  business_name: string;
};

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const id = parseId(params.id);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const raw = (body as Record<string, unknown>).note;
    if (typeof raw !== "string" || raw.trim() === "") {
      return NextResponse.json(
        { error: "note must be a non-empty string" },
        { status: 400 },
      );
    }
    const trimmed = raw.trim();

    const { rows } = await sql<NoteRow>`
      UPDATE chatter_notes
      SET note = ${trimmed}
      WHERE id = ${id}
      RETURNING id, client_id, note, created_at,
        (SELECT business_name FROM clients WHERE clients.id = chatter_notes.client_id) AS business_name
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error("[PATCH /api/notes/[id]]", err);
    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const id = parseId(params.id);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { rowCount } = await sql`DELETE FROM chatter_notes WHERE id = ${id}`;
    if (rowCount === 0) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[DELETE /api/notes/[id]]", err);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
