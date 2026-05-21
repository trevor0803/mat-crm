import { sql } from "../lib/db";

const members = ["Trevor", "Mike"];

async function seedTeam() {
  let inserted = 0;
  for (const name of members) {
    const result = await sql`
      INSERT INTO team_members (name)
      VALUES (${name})
      ON CONFLICT (name) DO NOTHING
    `;
    if (result.rowCount && result.rowCount > 0) inserted++;
  }
  console.log(
    `Team seed complete. ${inserted} inserted, ${members.length - inserted} skipped (already existed).`,
  );
}

seedTeam().catch((err) => {
  console.error("Team seed failed:", err);
  process.exit(1);
});
