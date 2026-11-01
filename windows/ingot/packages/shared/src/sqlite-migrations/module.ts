
export const sqliteMigrationsModule = {
  id: "sqlite-migrations",
  requires: [],
  provides: ["sqlite-migrations"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
