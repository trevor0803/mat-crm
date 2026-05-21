import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { sql } from "@/lib/db";

export const runtime = "nodejs";

type MediaRow = {
  id: number;
  client_id: number;
  filename: string;
  blob_url: string;
  blob_pathname: string;
  content_type: string | null;
  size_bytes: string | number;
  description: string | null;
  uploaded_at: string;
};

function normalize(row: MediaRow) {
  return { ...row, size_bytes: Number(row.size_bytes) };
}

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
    const raw = (body as Record<string, unknown>).description;
    if (raw !== null && typeof raw !== "string") {
      return NextResponse.json(
        { error: "description must be a string or null" },
        { status: 400 },
      );
    }
    const description =
      typeof raw === "string"
        ? raw.trim() === ""
          ? null
          : raw.trim()
        : null;

    const { rows } = await sql<MediaRow>`
      UPDATE media_files
      SET description = ${description}
      WHERE id = ${id}
      RETURNING id, client_id, filename, blob_url, blob_pathname,
                content_type, size_bytes, description, uploaded_at
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Media file not found" }, { status: 404 });
    }
    return NextResponse.json(normalize(rows[0]));
  } catch (err) {
    console.error("[PATCH /api/media/[id]]", err);
    return NextResponse.json({ error: "Failed to update media" }, { status: 500 });
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

    const { rows } = await sql<{ blob_url: string }>`
      SELECT blob_url FROM media_files WHERE id = ${id}
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Media file not found" }, { status: 404 });
    }

    try {
      await del(rows[0].blob_url);
    } catch (blobErr) {
      // Blob may already be gone — log and continue to remove the DB row.
      console.warn("[DELETE /api/media/[id]] blob delete failed", blobErr);
    }

    await sql`DELETE FROM media_files WHERE id = ${id}`;
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[DELETE /api/media/[id]]", err);
    return NextResponse.json({ error: "Failed to delete media" }, { status: 500 });
  }
}
