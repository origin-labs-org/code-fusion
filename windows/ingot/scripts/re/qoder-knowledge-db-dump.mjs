/**
 * Dumps the schema and a bounded sample of the real Qoder Repo Wiki cache.
 *
 * Input: a copy of `SharedClientCache/repowiki/knowledge.db` (+ -wal/-shm).
 * Output: schema DDL, per-table row counts, and the first rows of each table.
 */
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const dbPath = join(import.meta.dirname, "..", "..", "..", "re-tmp", "qoder-repowiki", "knowledge.db");
const db = new DatabaseSync(dbPath, { readOnly: false });

const master = db
  .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
  .all();

console.log("=== sqlite_master");
for (const row of master) {
  console.log(`\n-- ${row.type} ${row.name} (on ${row.tbl_name})`);
  if (row.sql) console.log(row.sql);
}

for (const row of master.filter((entry) => entry.type === "table")) {
  const name = row.name;
  const count = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get();
  console.log(`\n=== table ${name}: ${count.n} row(s)`);
  if (name.startsWith("sqlite_")) continue;
  const rows = db.prepare(`SELECT * FROM "${name}" LIMIT 3`).all();
  for (const sample of rows) {
    const trimmed = {};
    for (const [key, value] of Object.entries(sample)) {
      if (typeof value === "string") {
        trimmed[key] = value.length > 600 ? `${value.slice(0, 600)}… (${value.length} chars)` : value;
      } else if (value instanceof Uint8Array) {
        trimmed[key] = `<blob ${value.byteLength} bytes>`;
      } else {
        trimmed[key] = value;
      }
    }
    console.log(JSON.stringify(trimmed, null, 2));
  }
}

db.close();
