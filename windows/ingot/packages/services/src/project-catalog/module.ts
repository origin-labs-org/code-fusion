
export const projectCatalogModule = {
  id: "project-catalog",
  requires: ["project", "remote-projects"],
  provides: ["project-catalog"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
