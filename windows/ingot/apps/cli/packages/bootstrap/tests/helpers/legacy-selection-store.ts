import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSqliteSessionStore } from "@origin-ai/cf-adapters/storage";
import { SESSION_ENTRY_MODEL_SELECTION, type SessionId } from "@origin-ai/cf-contracts";

export async function createLegacySelectionStoreFixture() {
  const root = await mkdtemp(join(tmpdir(), "app-legacy-selection-"));
  const dbPath = join(root, "sessions.sqlite");
  let store = await createSqliteSessionStore({ dbPath });
  const db = new DatabaseSync(dbPath);
  return {
    get store() {
      return store;
    },
    async seedLegacy(sessionID: SessionId, data: unknown) {
      db.prepare(
        "insert into session_entry(id, session_id, type, time_created, time_updated, data) values(?,?,?,?,?,?)",
      ).run(
        `${sessionID}:runtime-model-selection`,
        sessionID,
        SESSION_ENTRY_MODEL_SELECTION,
        2,
        2,
        JSON.stringify(data),
      );
      store.close();
      db.exec("DELETE FROM schema_migration WHERE id='0020_provider_model_selection'");
      store = await createSqliteSessionStore({ dbPath });
    },
    async dispose() {
      db.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
