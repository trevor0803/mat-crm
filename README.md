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
- **Hosting:** Vercel

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

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Next.js dev server. |
| `npm run build` | Production build. |
| `npm run start` | Run the production build locally. |
| `npm run db:migrate` | Apply schema migrations. |
| `npm run db:seed` | Seed sample clients + notes. |
| `npm run db:seed-team` | Seed the team_members table. |
