import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

type TeamMemberRow = {
  id: number;
  name: string;
  active: boolean;
  created_at: string;
};

export async function GET() {
  try {
    const { rows } = await sql<TeamMemberRow>`
      SELECT id, name, active, created_at
      FROM team_members
      WHERE active = TRUE
      ORDER BY name ASC
    `;
    return NextResponse.json(rows);
  } catch (err) {
    console.error("[GET /api/team]", err);
    return NextResponse.json({ error: "Failed to fetch team members" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { name } = body as Record<string, unknown>;
    if (typeof name !== "string" || name.trim() === "") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { rows } = await sql<TeamMemberRow>`
      INSERT INTO team_members (name)
      VALUES (${name.trim()})
      RETURNING id, name, active, created_at
    `;
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return NextResponse.json(
        { error: "A team member with that name already exists." },
        { status: 409 },
      );
    }
    console.error("[POST /api/team]", err);
    return NextResponse.json({ error: "Failed to create team member" }, { status: 500 });
  }
}
