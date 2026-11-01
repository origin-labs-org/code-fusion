import { parentPort, workerData } from "node:worker_threads";
import { tasksStorageWorkerDataSchema } from "./contract.js";
import { prepareTasksIndexStorage, createSettingService } from "@origin-ai/cf-services/storage-startup";
import {
  classifyDatabaseStartupError,
  databaseStartupErrorDetails,
  databaseMigrationFactsSchema,
} from "@origin-ai/cf-shared";

const data = tasksStorageWorkerDataSchema.parse(workerData);
try {
  const settings = await createSettingService().get();
  await prepareTasksIndexStorage(
    data.path,
    (phase, migration) => parentPort?.postMessage({ type: "progress", phase, migration }),
    settings,
  );
  parentPort?.postMessage({ type: "done" });
} catch (error) {
  const migration = databaseMigrationFactsSchema.safeParse(
    error && typeof error === "object"
      ? (error as { startupMigration?: unknown }).startupMigration
      : undefined,
  );
  parentPort?.postMessage({
    type: "failed",
    migration: migration.success ? migration.data : undefined,
    errorCode: classifyDatabaseStartupError(error),
    ...databaseStartupErrorDetails(error),
  });
} finally {
  parentPort?.close();
}
