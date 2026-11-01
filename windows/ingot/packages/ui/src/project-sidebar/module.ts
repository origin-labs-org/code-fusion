
export const projectSidebarModule = {
  id: "project-sidebar",
  requires: [
    "services",
    "shared",
    "ui",
    "conversation-workspace-target",
    "web-remote-control-ui",
    "remote-connection-flow",
  ],
  provides: ["project-sidebar"],
  publicEntrypoints: [
    "index.tsx",
    "contract.ts",
    "remote-project-connection.ts",
    "useSavedWorkflowProjectOptions.ts",
    "RemoteProjectMenu.tsx",
    "WorkspaceDragOverlay.tsx",
    "useRemoteProjectConnectionPresentation.ts",
    "OfflineRemoteProjectRows.tsx",
    "RemoteConversationDisconnected.tsx",
  ],
} as const;
