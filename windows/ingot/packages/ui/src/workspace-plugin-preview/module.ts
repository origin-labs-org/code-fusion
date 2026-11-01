
export const workspacePluginPreviewModule = {
  id: "workspace-plugin-preview",
  requires: ["shared", "ui"],
  provides: ["workspace-plugin-preview"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
