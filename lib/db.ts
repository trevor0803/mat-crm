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
    ad_review_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ad_review_next_due DATE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
`;

// For databases created before the recurring ad-performance review feature:
// add the enrollment flag + next-due anchor (both idempotent). The daily
// ad-review cron only acts on clients where ad_review_enabled = TRUE.
export const ALTER_CLIENTS_ADD_AD_REVIEW = `
  ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS ad_review_enabled BOOLEAN NOT NULL DEFAULT FALSE;
`;

export const ALTER_CLIENTS_ADD_AD_REVIEW_NEXT_DUE = `
  ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS ad_review_next_due DATE;
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
    category TEXT NOT NULL DEFAULT 'work' CHECK (category IN ('work', 'billing')),
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    assignee_id INTEGER NOT NULL REFERENCES team_members(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP
  );
`;

// For databases created before the `category` column existed: add the column
// (idempotent), then classify any pre-existing auto-generated billing tasks —
// those created by the billing cron always have a "Bill <name> $<amount>" title.
export const ALTER_TASKS_ADD_CATEGORY = `
  ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'work'
      CHECK (category IN ('work', 'billing'));
`;

export const BACKFILL_TASKS_CATEGORY = `
  UPDATE tasks SET category = 'billing'
  WHERE category = 'work' AND title LIKE 'Bill %$%';
`;

export const CREATE_MEDIA_FILES_TABLE = `
  CREATE TABLE IF NOT EXISTS media_files (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    blob_url TEXT NOT NULL,
    blob_pathname TEXT NOT NULL,
    content_type TEXT,
    size_bytes BIGINT NOT NULL,
    description TEXT,
    uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
`;

export const CREATE_MEDIA_FILES_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_media_files_client_id ON media_files(client_id);
`;

// Daily Planner: one row per filled 30-minute slot of a given day.
// A (plan_date, slot_time) is unique so the planner can upsert per slot;
// an empty slot simply has no row. task_id optionally links a slot to a CRM
// task (ON DELETE SET NULL keeps the plan intact if the task is removed).
export const CREATE_PLANNER_SLOTS_TABLE = `
  CREATE TABLE IF NOT EXISTS planner_slots (
    id SERIAL PRIMARY KEY,
    plan_date DATE NOT NULL,
    slot_time TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    energy TEXT CHECK (energy IN ('deep', 'admin', 'meeting', 'break', 'buffer')),
    done BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (plan_date, slot_time)
  );
`;

export const CREATE_PLANNER_SLOTS_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_planner_slots_date ON planner_slots(plan_date);
`;
