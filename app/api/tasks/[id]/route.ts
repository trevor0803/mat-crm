import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

type TaskRow = {
  id: number;
  title: string;
  description: string | null;
  due_date: string | Date | null;
  priority: "low" | "medium" | "high";
  status: "pending" | "done";
  category: "work" | "billing";
  client_id: number | null;
  business_name: string | null;
  assignee_id: number;
  assignee_name: string;
  created_at: string;
  completed_at: string | null;
};

const ALLOWED_COLUMNS = [
  "title",
  "description",
  "due_date",
  "priority",
  "status",
  "category",
  "client_id",
  "assignee_id",
] as const;
type AllowedColumn = (typeof ALLOWED_COLUMNS)[number];

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeDueDate(d: string | Date | null): string | null {
  if (d === null || d === undefined) return null;
  if (d instanceof Date) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return d.slice(0, 10);
}

function normalize(row: TaskRow) {
  return { ...row, due_date: normalizeDueDate(row.due_date) };
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

    // Validate and coerce
    if ("title" in updates) {
      const v = updates.title;
      if (typeof v !== "string" || v.trim() === "") {
        return NextResponse.json(
          { error: "title must be a non-empty string" },
          { status: 400 },
        );
      }
      updates.title = v.trim();
    }
    if ("description" in updates) {
      const v = updates.description;
      if (v !== null && typeof v !== "string") {
        return NextResponse.json(
          { error: "description must be a string or null" },
          { status: 400 },
        );
      }
      updates.description = v === "" ? null : v;
    }
    if ("due_date" in updates) {
      const v = updates.due_date;
      if (v !== null && typeof v !== "string") {
        return NextResponse.json(
          { error: "due_date must be a string (YYYY-MM-DD) or null" },
          { status: 400 },
        );
      }
      updates.due_date = v === "" ? null : v;
    }
    if ("priority" in updates) {
      const v = updates.priority;
      if (v !== "low" && v !== "medium" && v !== "high") {
        return NextResponse.json(
          { error: "priority must be 'low', 'medium', or 'high'" },
          { status: 400 },
        );
      }
    }
    if ("status" in updates) {
      const v = updates.status;
      if (v !== "pending" && v !== "done") {
        return NextResponse.json(
          { error: "status must be 'pending' or 'done'" },
          { status: 400 },
        );
      }
    }
    if ("category" in updates) {
      const v = updates.category;
      if (v !== "work" && v !== "billing") {
        return NextResponse.json(
          { error: "category must be 'work' or 'billing'" },
          { status: 400 },
        );
      }
    }
    if ("client_id" in updates) {
      const v = updates.client_id;
      if (v !== null) {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isInteger(n) || n <= 0) {
          return NextResponse.json(
            { error: "client_id must be a positive integer or null" },
            { status: 400 },
          );
        }
        const { rows } = await sql<{ id: number }>`
          SELECT id FROM clients WHERE id = ${n}
        `;
        if (rows.length === 0) {
          return NextResponse.json(
            { error: "client_id does not reference a client" },
            { status: 400 },
          );
        }
        updates.client_id = n;
      }
    }
    if ("assignee_id" in updates) {
      const v = updates.assignee_id;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json(
          { error: "assignee_id must be a positive integer" },
          { status: 400 },
        );
      }
      const { rows } = await sql<{ id: number }>`
        SELECT id FROM team_members WHERE id = ${n}
      `;
      if (rows.length === 0) {
        return NextResponse.json(
          { error: "assignee_id does not reference a team member" },
          { status: 400 },
        );
      }
      updates.assignee_id = n;
    }

    // Mirror status -> completed_at
    const setClauses: string[] = [];
    const values: unknown[] = [];
    for (const k of keys) {
      values.push(updates[k]);
      setClauses.push(`${k} = $${values.length}`);
    }
    if ("status" in updates) {
      if (updates.status === "done") {
        setClauses.push(`completed_at = NOW()`);
      } else {
        setClauses.push(`completed_at = NULL`);
      }
    }

    values.push(id);
    const text = `
      WITH updated AS (
        UPDATE tasks
        SET ${setClauses.join(", ")}
        WHERE id = $${values.length}
        RETURNING id, title, description, due_date, priority, status, category,
                  client_id, assignee_id, created_at, completed_at
      )
      SELECT u.id, u.title, u.description, u.due_date, u.priority, u.status, u.category,
             u.client_id, c.business_name, u.assignee_id, tm.name AS assignee_name,
             u.created_at, u.completed_at
      FROM updated u
      LEFT JOIN clients c ON c.id = u.client_id
      INNER JOIN team_members tm ON tm.id = u.assignee_id
    `;

    const { rows } = await sql.query<TaskRow>(text, values);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json(normalize(rows[0]));
  } catch (err) {
    console.error("[PATCH /api/tasks/[id]]", err);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseId(params.id);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { rowCount } = await sql`DELETE FROM tasks WHERE id = ${id}`;
    if (rowCount === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[DELETE /api/tasks/[id]]", err);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
