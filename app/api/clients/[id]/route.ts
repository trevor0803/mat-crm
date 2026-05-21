import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

type ClientRow = {
  id: number;
  business_name: string;
  uses_ghl: boolean;
  retainer: string | number;
  bill_date: string | null;
  active: boolean;
  billing_method: string | null;
  ad_spend_dates: string | null;
  created_at: string;
};

const ALLOWED_COLUMNS = [
  "business_name",
  "uses_ghl",
  "retainer",
  "bill_date",
  "active",
  "billing_method",
  "ad_spend_dates",
] as const;

type AllowedColumn = (typeof ALLOWED_COLUMNS)[number];

function normalize(row: ClientRow) {
  return { ...row, retainer: Number(row.retainer) };
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseId(params.id);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { rows } = await sql<ClientRow>`
      SELECT id, business_name, uses_ghl, retainer, bill_date, active,
             billing_method, ad_spend_dates, created_at
      FROM clients
      WHERE id = ${id}
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    return NextResponse.json(normalize(rows[0]));
  } catch (err) {
    console.error("[GET /api/clients/[id]]", err);
    return NextResponse.json({ error: "Failed to fetch client" }, { status: 500 });
  }
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

    if ("retainer" in updates) {
      const r = updates.retainer;
      const n = typeof r === "number" ? r : Number(r);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: "retainer must be a number" }, { status: 400 });
      }
      updates.retainer = n;
    }
    if ("business_name" in updates) {
      const v = updates.business_name;
      if (typeof v !== "string" || v.trim() === "") {
        return NextResponse.json(
          { error: "business_name must be a non-empty string" },
          { status: 400 },
        );
      }
      updates.business_name = v.trim();
    }
    for (const boolKey of ["uses_ghl", "active"] as const) {
      if (boolKey in updates && typeof updates[boolKey] !== "boolean") {
        return NextResponse.json({ error: `${boolKey} must be a boolean` }, { status: 400 });
      }
    }
    for (const strKey of ["bill_date", "billing_method", "ad_spend_dates"] as const) {
      if (strKey in updates) {
        const v = updates[strKey];
        if (v !== null && typeof v !== "string") {
          return NextResponse.json(
            { error: `${strKey} must be a string or null` },
            { status: 400 },
          );
        }
      }
    }

    // Column names come from a hardcoded allowlist, so inlining them is safe.
    // Values are passed as parameters via sql.query.
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]);
    values.push(id);

    const text = `
      UPDATE clients
      SET ${setClauses}
      WHERE id = $${values.length}
      RETURNING id, business_name, uses_ghl, retainer, bill_date, active,
                billing_method, ad_spend_dates, created_at
    `;

    const { rows } = await sql.query<ClientRow>(text, values);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    return NextResponse.json(normalize(rows[0]));
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return NextResponse.json(
        { error: "A client with that business name already exists." },
        { status: 409 },
      );
    }
    console.error("[PATCH /api/clients/[id]]", err);
    return NextResponse.json({ error: "Failed to update client" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseId(params.id);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { rowCount } = await sql`DELETE FROM clients WHERE id = ${id}`;
    if (rowCount === 0) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[DELETE /api/clients/[id]]", err);
    return NextResponse.json({ error: "Failed to delete client" }, { status: 500 });
  }
}
