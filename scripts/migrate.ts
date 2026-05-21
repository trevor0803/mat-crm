import {
  sql,
  CREATE_CLIENTS_TABLE,
  CREATE_CHATTER_NOTES_TABLE,
  CREATE_TEAM_MEMBERS_TABLE,
  CREATE_TASKS_TABLE,
} from "../lib/db";

async function migrate() {
  await sql.query(CREATE_CLIENTS_TABLE);
  console.log("clients: ready");

  await sql.query(CREATE_CHATTER_NOTES_TABLE);
  console.log("chatter_notes: ready");

  await sql.query(CREATE_TEAM_MEMBERS_TABLE);
  console.log("team_members: ready");

  await sql.query(CREATE_TASKS_TABLE);
  console.log("tasks: ready");

  console.log("Migration complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
