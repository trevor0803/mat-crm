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

export const CREATE_TEAM_MEMBERS_TABLE = `
  CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
`;

export const CREATE_TASKS_TABLE = `
  CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    due_date DATE,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    assignee_id INTEGER NOT NULL REFERENCES team_members(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP
  );
`;
