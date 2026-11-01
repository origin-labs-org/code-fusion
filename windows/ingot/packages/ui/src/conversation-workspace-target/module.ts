
export const conversationWorkspaceTargetModule = {
  id: "conversation-workspace-target",
  requires: ["shared", "ui"],
  provides: ["conversation-workspace-target"],
  publicEntrypoints: [
    "index.ts",
    "contract.ts",
    "purpose.ts",
    "sourceIdentity.ts",
    "workbenchTarget.ts",
    "usePluginCreator.ts",
    "PluginAddMenu.tsx",
  ],
} as const;
