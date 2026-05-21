import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

type TeamMemberRow = {
  id: number;
  name: string;
  active: boolean;
  created_at: string;
};

const ALLOWED_COLUMNS = ["name", "active"] as const;
type AllowedColumn = (typeof ALLOWED_COLUMNS)[number];

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseId(params.id);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const updates: Partial<Record<AllowedColumn, unknown>> = {};
    for (const key of ALLOWED_COLUMNS) {
      if (key in body) {
        updates[key] = (body as Record<string, unknown>)[key];
      }
    }

    const keys = Object.keys(updates) as AllowedColumn[];
    if (keys.length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    if ("name" in updates) {
      const v = updates.name;
      if (typeof v !== "string" || v.trim() === "") {
        return NextResponse.json(
          { error: "name must be a non-empty string" },
          { status: 400 },
        );
      }
      updates.name = v.trim();
    }
    if ("active" in updates && typeof updates.active !== "boolean") {
      return NextResponse.json({ error: "active must be a boolean" }, { status: 400 });
    }

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]);
    values.push(id);

    const text = `
      UPDATE team_members
      SET ${setClauses}
      WHERE id = $${values.length}
      RETURNING id, name, active, created_at
    `;

    const { rows } = await sql.query<TeamMemberRow>(text, values);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return NextResponse.json(
        { error: "A team member with that name already exists." },
        { status: 409 },
      );
    }
    console.error("[PATCH /api/team/[id]]", err);
    return NextResponse.json({ error: "Failed to update team member" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseId(params.id);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { rows: refRows } = await sql<{ count: string }>`
      SELECT COUNT(*)::text AS count FROM tasks WHERE assignee_id = ${id}
    `;
    if (Number(refRows[0]?.count ?? "0") > 0) {
      return NextResponse.json(
        { error: "This team member has tasks assigned. Reassign them first." },
        { status: 409 },
      );
    }

    const { rowCount } = await sql`DELETE FROM team_members WHERE id = ${id}`;
    if (rowCount === 0) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[DELETE /api/team/[id]]", err);
    return NextResponse.json({ error: "Failed to delete team member" }, { status: 500 });
  }
}
