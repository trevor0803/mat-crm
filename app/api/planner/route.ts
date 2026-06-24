import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { isValidSlotTime, isValidEnergy } from "@/lib/planner";

type SlotRow = {
  id: number;
  plan_date: string | Date;
  slot_time: string;
  title: string;
  task_id: number | null;
  energy: string | null;
  done: boolean;
};

type TaskRow = {
  id: number;
  title: string;
  due_date: string | Date | null;
  priority: "low" | "medium" | "high";
  category: "work" | "billing";
  client_id: number | null;
  business_name: string | null;
  assignee_name: string;
};

function normalizeDate(d: string | Date | null): string | null {
  if (d === null || d === undefined) return null;
  if (d instanceof Date) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return d.slice(0, 10);
}

function normalizeSlot(row: SlotRow) {
  return { ...row, plan_date: normalizeDate(row.plan_date) };
}

function normalizeTask(row: TaskRow) {
  return { ...row, due_date: normalizeDate(row.due_date) };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/planner?date=YYYY-MM-DD
// Returns the day's filled slots plus the CRM tasks relevant to that day
// (open tasks due on or before that date) so they can be dropped into slots.
export async function GET(req: NextRequest) {
  try {
    const date = new URL(req.url).searchParams.get("date");
    if (!date || !DATE_RE.test(date)) {
      return NextResponse.json(
        { error: "date query param is required (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const { rows: slotRows } = await sql<SlotRow>`
      SELECT id, plan_date, slot_time, title, task_id, energy, done
      FROM planner_slots
      WHERE plan_date = ${date}
      ORDER BY slot_time ASC
    `;

    const { rows: taskRows } = await sql<TaskRow>`
      SELECT t.id, t.title, t.due_date, t.priority, t.category,
             t.client_id, c.business_name, tm.name AS assignee_name
      FROM tasks t
      LEFT JOIN clients c ON c.id = t.client_id
      INNER JOIN team_members tm ON tm.id = t.assignee_id
      WHERE t.status = 'pending' AND t.due_date IS NOT NULL AND t.due_date <= ${date}
      ORDER BY t.due_date ASC,
        CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC
    `;

    return NextResponse.json({
      date,
      slots: slotRows.map(normalizeSlot),
      tasks: taskRows.map(normalizeTask),
    });
  } catch (err) {
    console.error("[GET /api/planner]", err);
    return NextResponse.json({ error: "Failed to load planner" }, { status: 500 });
  }
}

// PUT /api/planner  body: { date, slot_time, title?, task_id?, energy?, done? }
// Upserts one slot. If the slot ends up empty (no title, no task, not done)
// the row is deleted so empty slots leave no trace.
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { date, slot_time, title, task_id, energy, done } = body as Record<
      string,
      unknown
    >;

    if (typeof date !== "string" || !DATE_RE.test(date)) {
      return NextResponse.json(
        { error: "date is required (YYYY-MM-DD)" },
        { status: 400 },
      );
    }
    if (!isValidSlotTime(slot_time)) {
      return NextResponse.json({ error: "invalid slot_time" }, { status: 400 });
    }
    if (title !== undefined && title !== null && typeof title !== "string") {
      return NextResponse.json({ error: "title must be a string" }, { status: 400 });
    }
    if (energy !== undefined && energy !== null && !isValidEnergy(energy)) {
      return NextResponse.json({ error: "invalid energy" }, { status: 400 });
    }
    if (done !== undefined && typeof done !== "boolean") {
      return NextResponse.json({ error: "done must be a boolean" }, { status: 400 });
    }

    let taskIdVal: number | null = null;
    if (task_id !== undefined && task_id !== null && task_id !== "") {
      const n = typeof task_id === "number" ? task_id : Number(task_id);
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json(
          { error: "task_id must be a positive integer" },
          { status: 400 },
        );
      }
      const { rows } = await sql<{ id: number }>`SELECT id FROM tasks WHERE id = ${n}`;
      if (rows.length === 0) {
        return NextResponse.json(
          { error: "task_id does not reference a task" },
          { status: 400 },
        );
      }
      taskIdVal = n;
    }

    const titleVal = typeof title === "string" ? title.trim() : "";
    const energyVal = isValidEnergy(energy) ? energy : null;
    const doneVal = done === true;

    // Nothing to keep — clear the slot.
    if (titleVal === "" && taskIdVal === null && !doneVal) {
      await sql`
        DELETE FROM planner_slots WHERE plan_date = ${date} AND slot_time = ${slot_time}
      `;
      return NextResponse.json({ slot: null });
    }

    const { rows } = await sql<SlotRow>`
      INSERT INTO planner_slots (plan_date, slot_time, title, task_id, energy, done)
      VALUES (${date}, ${slot_time}, ${titleVal}, ${taskIdVal}, ${energyVal}, ${doneVal})
      ON CONFLICT (plan_date, slot_time) DO UPDATE
        SET title = EXCLUDED.title,
            task_id = EXCLUDED.task_id,
            energy = EXCLUDED.energy,
            done = EXCLUDED.done,
            updated_at = NOW()
      RETURNING id, plan_date, slot_time, title, task_id, energy, done
    `;

    return NextResponse.json({ slot: normalizeSlot(rows[0]) });
  } catch (err) {
    console.error("[PUT /api/planner]", err);
    return NextResponse.json({ error: "Failed to save slot" }, { status: 500 });
  }
}

// DELETE /api/planner?date=YYYY-MM-DD&slot_time=HH:MM  — clear a single slot.
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    const slot_time = url.searchParams.get("slot_time");
    if (!date || !DATE_RE.test(date)) {
      return NextResponse.json({ error: "date is required" }, { status: 400 });
    }
    if (!isValidSlotTime(slot_time)) {
      return NextResponse.json({ error: "invalid slot_time" }, { status: 400 });
    }
    await sql`
      DELETE FROM planner_slots WHERE plan_date = ${date} AND slot_time = ${slot_time}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/planner]", err);
    return NextResponse.json({ error: "Failed to clear slot" }, { status: 500 });
  }
}
