
import type { DatabaseSync } from "node:sqlite";
import type { ProjectStorageContract } from "#src/project-storage/contract.js";

export async function exampleProjectStorage(
  port: ProjectStorageContract,
  db: DatabaseSync,
  backupDirectory: string,
): Promise<void> {
  await port.migrate(db, { backupDirectories: [backupDirectory] });
}
