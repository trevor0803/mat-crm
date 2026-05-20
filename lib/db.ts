import { sql } from "@vercel/postgres";

export { sql };

export const CREATE_CLIENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    business_name TEXT UNIQUE NOT NULL,
    uses_ghl BOOLEAN NOT NULL DEFAULT FALSE,
    retainer NUMERIC NOT NULL,
    bill_date TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    billing_method TEXT,
    ad_spend_dates TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
`;

export const CREATE_CHATTER_NOTES_TABLE = `
  CREATE TABLE IF NOT EXISTS chatter_notes (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
`;
