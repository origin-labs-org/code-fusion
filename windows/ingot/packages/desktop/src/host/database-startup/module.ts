
export const hostDatabaseStartupModule = {
  id: "host-database-startup",
  requires: ["project-storage", "shared", "desktop"],
  provides: ["host-database-startup"],
  publicEntrypoints: [
    "contract.ts",
    "tasksStorageWorker.ts",
    "hostDatabaseStartup.ts",
    "storagePreparationProcesses.ts",
  ],
} as const;
