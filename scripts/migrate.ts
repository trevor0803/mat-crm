import {
  sql,
  CREATE_CLIENTS_TABLE,
  CREATE_CHATTER_NOTES_TABLE,
  CREATE_TEAM_MEMBERS_TABLE,
  CREATE_TASKS_TABLE,
  ALTER_TASKS_ADD_CATEGORY,
  BACKFILL_TASKS_CATEGORY,
  CREATE_MEDIA_FILES_TABLE,
  CREATE_MEDIA_FILES_INDEX,
} from "../lib/db";

async function migrate() {
  await sql.query(CREATE_CLIENTS_TABLE);
  console.log("clients: ready");

  await sql.query(CREATE_CHATTER_NOTES_TABLE);
  console.log("chatter_notes: ready");

  await sql.query(CREATE_TEAM_MEMBERS_TABLE);
  console.log("team_members: ready");

  await sql.query(CREATE_TASKS_TABLE);
  await sql.query(ALTER_TASKS_ADD_CATEGORY);
  await sql.query(BACKFILL_TASKS_CATEGORY);
  console.log("tasks: ready");

  await sql.query(CREATE_MEDIA_FILES_TABLE);
  await sql.query(CREATE_MEDIA_FILES_INDEX);
  console.log("media_files: ready");

  console.log("Migration complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
