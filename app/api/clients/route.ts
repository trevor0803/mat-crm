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
  ad_review_enabled: boolean;
  ad_review_next_due: string | Date | null;
  created_at: string;
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

function normalize(row: ClientRow) {
  return {
    ...row,
    retainer: Number(row.retainer),
    ad_review_next_due: normalizeDate(row.ad_review_next_due),
  };
}

export async function GET() {
  try {
    const { rows } = await sql<ClientRow>`
      SELECT id, business_name, uses_ghl, retainer, bill_date, active,
             billing_method, ad_spend_dates, ad_review_enabled,
             ad_review_next_due, created_at
      FROM clients
      ORDER BY business_name ASC
    `;
    return NextResponse.json(rows.map(normalize));
  } catch (err) {
    console.error("[GET /api/clients]", err);
    return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const {
      business_name,
      uses_ghl,
      retainer,
      bill_date,
      active,
      billing_method,
      ad_spend_dates,
    } = body as Record<string, unknown>;

    if (typeof business_name !== "string" || business_name.trim() === "") {
      return NextResponse.json({ error: "business_name is required" }, { status: 400 });
    }
    if (typeof uses_ghl !== "boolean") {
      return NextResponse.json({ error: "uses_ghl must be a boolean" }, { status: 400 });
    }
    const retainerNum = typeof retainer === "number" ? retainer : Number(retainer);
    if (!Number.isFinite(retainerNum)) {
      return NextResponse.json({ error: "retainer must be a number" }, { status: 400 });
    }
    if (bill_date !== null && bill_date !== undefined && typeof bill_date !== "string") {
      return NextResponse.json({ error: "bill_date must be a string or null" }, { status: 400 });
    }
    if (typeof active !== "boolean") {
      return NextResponse.json({ error: "active must be a boolean" }, { status: 400 });
    }
    if (
      billing_method !== null &&
      billing_method !== undefined &&
      typeof billing_method !== "string"
    ) {
      return NextResponse.json(
        { error: "billing_method must be a string or null" },
        { status: 400 },
      );
    }
    if (
      ad_spend_dates !== null &&
      ad_spend_dates !== undefined &&
      typeof ad_spend_dates !== "string"
    ) {
      return NextResponse.json(
        { error: "ad_spend_dates must be a string or null" },
        { status: 400 },
      );
    }

    const { rows } = await sql<ClientRow>`
      INSERT INTO clients
        (business_name, uses_ghl, retainer, bill_date, active, billing_method, ad_spend_dates)
      VALUES
        (${business_name.trim()}, ${uses_ghl}, ${retainerNum}, ${bill_date ?? null},
         ${active}, ${billing_method ?? null}, ${ad_spend_dates ?? null})
      RETURNING id, business_name, uses_ghl, retainer, bill_date, active,
                billing_method, ad_spend_dates, ad_review_enabled,
                ad_review_next_due, created_at
    `;

    return NextResponse.json(normalize(rows[0]), { status: 201 });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return NextResponse.json(
        { error: "A client with that business name already exists." },
        { status: 409 },
      );
    }
    console.error("[POST /api/clients]", err);
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
  }
}
