
export const startupStorageModule = {
  id: "startup-storage",
  requires: ["sqlite-migrations"],
  provides: ["startup-storage"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
