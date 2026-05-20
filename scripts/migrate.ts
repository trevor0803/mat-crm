import {
  sql,
  CREATE_CLIENTS_TABLE,
  CREATE_CHATTER_NOTES_TABLE,
} from "../lib/db";

async function migrate() {
  await sql.query(CREATE_CLIENTS_TABLE);
  console.log("clients: ready");

  await sql.query(CREATE_CHATTER_NOTES_TABLE);
  console.log("chatter_notes: ready");

  console.log("Migration complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
