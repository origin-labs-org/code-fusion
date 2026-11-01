
export const workspaceConfigCatalogModule = {
  id: "workspace-config-catalog",
  requires: ["services", "shared", "ui"],
  provides: ["workspace-config-catalog"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
