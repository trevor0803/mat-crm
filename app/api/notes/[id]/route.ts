import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
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
