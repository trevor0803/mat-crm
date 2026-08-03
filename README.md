# MAT Digital CRM

Internal CRM for MAT Digital — tracks clients, retainers, billing cadence, tasks,
and chatter notes in one place. Used by the team in West Palm Beach to run the
agency day-to-day.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Database:** Vercel Postgres (Neon)
- **File storage:** Vercel Blob
- **Toasts:** sonner
- **Icons:** lucide-react
- **Command box:** Claude (Anthropic Messages API) + Web Speech API
- **Hosting:** Vercel

## Command Box (talk/type to the CRM)

The bar under the header turns a plain sentence into CRM changes. Type it, or
hit the mic and say it — Chrome and Edge transcribe locally, and it runs
automatically when you stop talking.

> "add a task for McGrath Plumbing to check the landing page due tomorrow for Trevor"

Nothing is written until you review the preview card and press **Save**. Task
cards are editable inline, so a misheard client or date is a one-click fix.

**What it can do:** create tasks · mark tasks done · reschedule, reassign,
re-prioritise or rename tasks · delete tasks · add clients · update client
retainer / bill date / billing method / active status / ad-review settings ·
add chatter notes · block time on the planner · answer questions about what's
in the CRM ("what's due today", "how much does McGrath pay us").

**Shortcut:** `Cmd/Ctrl + K` focuses the box from anywhere. `Enter` runs it,
`Shift + Enter` adds a line, `Esc` discards a preview.

### One-time setup

1. Get an API key at <https://console.anthropic.com> → **API Keys**.
2. Add it locally to `.env.local` **and** `.env.development.local`:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

3. Add the same key to Vercel: project → **Settings → Environment Variables**
   → name `ANTHROPIC_API_KEY`, checked for Production, Preview and Development.
   Redeploy (or push to `main`) for it to take effect.

Optional overrides:

| Variable | Default | Purpose |
| --- | --- | --- |
| `COMMAND_MODEL` | `claude-sonnet-4-6` | Swap the model (e.g. a cheaper Haiku). |
| `COMMAND_DEFAULT_ASSIGNEE` | `Trevor` | Who gets a task when no name is said. |

### How it's wired

| File | Role |
| --- | --- |
| `components/CommandBox.tsx` | The bar, the mic, and the preview cards. |
| `lib/command.ts` | Types + helpers shared by browser and server. |
| `lib/command-server.ts` | CRM context, the Claude call, validation, SQL. |
| `app/api/command/parse` | Sentence → preview plan. Read-only. |
| `app/api/command/execute` | Preview plan → database writes. |

Every payload is re-validated server-side at execute time against freshly
loaded CRM state, so an edited or stale preview can't write bad data. Pages
that load data client-side listen for the `crm:changed` window event and
refetch after a save.

Run the validator tests (no API key or database needed):

```bash
npm run test:command
```

## Local Setup

```bash
# 1. Clone
git clone <repo-url>
cd mat-crm

# 2. Install
npm install

# 3. Link the Vercel project (one-time)
vercel link

# 4. Pull dev env vars from Vercel
vercel env pull .env.development.local

# If your tooling reads .env.local, copy it:
cp .env.development.local .env.local

# 5. Run database migrations
npm run db:migrate

# 6. Seed (optional — sample clients + team)
npm run db:seed
npm run db:seed-team

# 7. Start the dev server
npm run dev
```

Open <http://localhost:3000>.

## Vercel Blob Setup

Per-client media uploads are stored in Vercel Blob. One-time setup:

1. Open the Vercel project → **Storage** tab.
2. **Create Blob store** → name it `mat-crm-media`.
3. Connect the store to this project in **all environments** (Development,
   Preview, Production). Vercel will inject `BLOB_READ_WRITE_TOKEN` into the
   project's env vars automatically.
4. Pull the new env var locally:

   ```bash
   vercel env pull .env.development.local
   cp .env.development.local .env.local   # if your tooling reads .env.local
   ```

Uploads cap at **500MB per file**.

## Deployment

This repo is wired to Vercel. Pushing to `main` triggers an automatic
production deploy — no manual steps required.

Database migrations are run locally (`npm run db:migrate`) against the
shared Vercel Postgres instance, so they take effect for production
immediately. Coordinate schema changes with the team.

## Cron Setup

A daily cron generates billing tasks automatically. Every day at **11:00 UTC**
(6am EST / 7am EDT) it scans active clients and creates a `Bill [Client] $XXX`
task — assigned to Trevor, due that day — for any client whose `bill_date`
day-of-month matches today. It's idempotent: re-running it the same day won't
create duplicate tasks.

The schedule lives in `vercel.json` and points at
`/api/cron/generate-billing-tasks`.

**One-time setup:**

1. Add a `CRON_SECRET` environment variable to the Vercel project in
   **Production** (Settings → Environment Variables). Use a long random string.
   Vercel automatically sends it as `Authorization: Bearer <CRON_SECRET>` when
   invoking the cron, and the route rejects any request that doesn't match.

**Notes:**

- Cron jobs only run on **Production** deploys — they do not fire on Preview
  or Development deployments.
- To test the logic locally (or on a Preview deploy), hit
  `/api/cron/generate-billing-tasks/test` — it runs the identical logic with no
  auth check. This test endpoint is disabled on Production.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Next.js dev server. |
| `npm run build` | Production build. |
| `npm run start` | Run the production build locally. |
| `npm run db:migrate` | Apply schema migrations. |
| `npm run db:seed` | Seed sample clients + notes. |
| `npm run db:seed-team` | Seed the team_members table. |
