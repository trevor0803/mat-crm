import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { sql } from "@/lib/db";
import { MAX_FILE_SIZE_BYTES, sanitizeFilename } from "@/lib/media";

export const runtime = "nodejs";
export const maxDuration = 60;

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

async function clientExists(id: number): Promise<boolean> {
  const { rows } = await sql<{ id: number }>`SELECT id FROM clients WHERE id = ${id}`;
  return rows.length > 0;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const clientId = parseId(params.id);
    if (clientId === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    if (!(await clientExists(clientId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const { rows } = await sql<MediaRow>`
      SELECT id, client_id, filename, blob_url, blob_pathname,
             content_type, size_bytes, description, uploaded_at
      FROM media_files
      WHERE client_id = ${clientId}
      ORDER BY uploaded_at DESC, id DESC
    `;
    return NextResponse.json(rows.map(normalize));
  } catch (err) {
    console.error("[GET /api/clients/[id]/media]", err);
    return NextResponse.json({ error: "Failed to fetch media" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const clientId = parseId(params.id);
    if (clientId === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    if (!(await clientExists(clientId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const formData = await req.formData();
    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { error: "Missing file in form data" },
        { status: 400 },
      );
    }
    if (fileEntry.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }
    if (fileEntry.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File too large. Max 500MB per file." },
        { status: 413 },
      );
    }

    const rawDescription = formData.get("description");
    const description =
      typeof rawDescription === "string" && rawDescription.trim() !== ""
        ? rawDescription.trim()
        : null;

    const safeName = sanitizeFilename(fileEntry.name);
    const pathname = `clients/${clientId}/${Date.now()}-${safeName}`;

    const blob = await put(pathname, fileEntry, {
      access: "public",
      addRandomSuffix: false,
      contentType: fileEntry.type || undefined,
    });

    const { rows } = await sql<MediaRow>`
      INSERT INTO media_files (
        client_id, filename, blob_url, blob_pathname,
        content_type, size_bytes, description
      )
      VALUES (
        ${clientId}, ${fileEntry.name}, ${blob.url}, ${blob.pathname},
        ${fileEntry.type || null}, ${fileEntry.size}, ${description}
      )
      RETURNING id, client_id, filename, blob_url, blob_pathname,
                content_type, size_bytes, description, uploaded_at
    `;
    return NextResponse.json(normalize(rows[0]), { status: 201 });
  } catch (err) {
    console.error("[POST /api/clients/[id]/media]", err);
    const message =
      err instanceof Error && err.message ? err.message : "Failed to upload file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
