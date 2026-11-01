
export const projectStorageModule = {
  id: "project-storage",
  requires: ["shared", "sqlite-migrations", "services", "session"],
  provides: ["project-storage"],
  publicEntrypoints: ["index.ts", "contract.ts", "startup.ts", "startup-entry.ts"],
} as const;
