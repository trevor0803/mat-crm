import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

type TaskRow = {
  id: number;
  title: string;
  description: string | null;
  due_date: string | Date | null;
  priority: "low" | "medium" | "high";
  status: "pending" | "done";
  client_id: number | null;
  business_name: string | null;
  assignee_id: number;
  assignee_name: string;
  created_at: string;
  completed_at: string | null;
};

const SELECT_COLUMNS = `
  t.id, t.title, t.description, t.due_date, t.priority, t.status,
  t.client_id, c.business_name, t.assignee_id, tm.name AS assignee_name,
  t.created_at, t.completed_at
`;

const JOIN_CLAUSE = `
  FROM tasks t
  LEFT JOIN clients c ON c.id = t.client_id
  INNER JOIN team_members tm ON tm.id = t.assignee_id
`;

function normalizeDueDate(d: string | Date | null): string | null {
  if (d === null || d === undefined) return null;
  if (d instanceof Date) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  // String may arrive as "YYYY-MM-DD" or with time portion — trim to date.
  return d.slice(0, 10);
}

function normalize(row: TaskRow) {
  return { ...row, due_date: normalizeDueDate(row.due_date) };
}

function parsePositiveInt(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status") ?? "pending";
    const clientIdRaw = url.searchParams.get("client_id");
    const assigneeIdRaw = url.searchParams.get("assignee_id");

    if (!["pending", "done", "all"].includes(statusParam)) {
      return NextResponse.json(
        { error: "status must be 'pending', 'done', or 'all'" },
        { status: 400 },
      );
    }

    const where: string[] = [];
    const values: unknown[] = [];

    if (statusParam !== "all") {
      values.push(statusParam);
      where.push(`t.status = $${values.length}`);
    }

    if (clientIdRaw !== null) {
      const clientId = parsePositiveInt(clientIdRaw);
      if (clientId === null) {
        return NextResponse.json({ error: "Invalid client_id" }, { status: 400 });
      }
      values.push(clientId);
      where.push(`t.client_id = $${values.length}`);
    }

    if (assigneeIdRaw !== null) {
      const assigneeId = parsePositiveInt(assigneeIdRaw);
      if (assigneeId === null) {
        return NextResponse.json({ error: "Invalid assignee_id" }, { status: 400 });
      }
      values.push(assigneeId);
      where.push(`t.assignee_id = $${values.length}`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    // For "done" only, sort by completed_at DESC. Otherwise (pending or all),
    // use the pending ordering.
    const orderClause =
      statusParam === "done"
        ? `ORDER BY t.completed_at DESC`
        : `ORDER BY t.due_date ASC NULLS LAST,
             CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END ASC,
             t.created_at ASC`;

    const text = `
      SELECT ${SELECT_COLUMNS}
      ${JOIN_CLAUSE}
      ${whereClause}
      ${orderClause}
    `;

    const { rows } = await sql.query<TaskRow>(text, values);
    return NextResponse.json(rows.map(normalize));
  } catch (err) {
    console.error("[GET /api/tasks]", err);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const {
      title,
      description,
      due_date,
      priority,
      client_id,
      assignee_id,
    } = body as Record<string, unknown>;

    if (typeof title !== "string" || title.trim() === "") {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (
      description !== undefined &&
      description !== null &&
      typeof description !== "string"
    ) {
      return NextResponse.json(
        { error: "description must be a string or null" },
        { status: 400 },
      );
    }
    if (due_date !== undefined && due_date !== null && typeof due_date !== "string") {
      return NextResponse.json(
        { error: "due_date must be a string (YYYY-MM-DD) or null" },
        { status: 400 },
      );
    }

    let priorityVal: "low" | "medium" | "high" = "medium";
    if (priority !== undefined && priority !== null) {
      if (priority !== "low" && priority !== "medium" && priority !== "high") {
        return NextResponse.json(
          { error: "priority must be 'low', 'medium', or 'high'" },
          { status: 400 },
        );
      }
      priorityVal = priority;
    }

    const assigneeIdNum =
      typeof assignee_id === "number" ? assignee_id : Number(assignee_id);
    if (!Number.isInteger(assigneeIdNum) || assigneeIdNum <= 0) {
      return NextResponse.json(
        { error: "assignee_id is required and must be a positive integer" },
        { status: 400 },
      );
    }

    const { rows: assigneeRows } = await sql<{ id: number }>`
      SELECT id FROM team_members WHERE id = ${assigneeIdNum}
    `;
    if (assigneeRows.length === 0) {
      return NextResponse.json(
        { error: "assignee_id does not reference a team member" },
        { status: 400 },
      );
    }

    let clientIdVal: number | null = null;
    if (client_id !== undefined && client_id !== null && client_id !== "") {
      const n = typeof client_id === "number" ? client_id : Number(client_id);
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json(
          { error: "client_id must be a positive integer" },
          { status: 400 },
        );
      }
      const { rows: clientRows } = await sql<{ id: number }>`
        SELECT id FROM clients WHERE id = ${n}
      `;
      if (clientRows.length === 0) {
        return NextResponse.json(
          { error: "client_id does not reference a client" },
          { status: 400 },
        );
      }
      clientIdVal = n;
    }

    const trimmedTitle = title.trim();
    const descriptionVal =
      description === undefined || description === null || description === ""
        ? null
        : (description as string);
    const dueDateVal =
      due_date === undefined || due_date === null || due_date === ""
        ? null
        : (due_date as string);

    const { rows } = await sql<TaskRow>`
      WITH inserted AS (
        INSERT INTO tasks (title, description, due_date, priority, client_id, assignee_id)
        VALUES (${trimmedTitle}, ${descriptionVal}, ${dueDateVal}, ${priorityVal},
                ${clientIdVal}, ${assigneeIdNum})
        RETURNING id, title, description, due_date, priority, status,
                  client_id, assignee_id, created_at, completed_at
      )
      SELECT i.id, i.title, i.description, i.due_date, i.priority, i.status,
             i.client_id, c.business_name, i.assignee_id, tm.name AS assignee_name,
             i.created_at, i.completed_at
      FROM inserted i
      LEFT JOIN clients c ON c.id = i.client_id
      INNER JOIN team_members tm ON tm.id = i.assignee_id
    `;

    return NextResponse.json(normalize(rows[0]), { status: 201 });
  } catch (err) {
    console.error("[POST /api/tasks]", err);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
