
export const projectWorkspaceNavigationModule = {
  id: "project-workspace-navigation",
  requires: ["project", "project-catalog", "remote-projects", "shared"],
  provides: ["project-workspace-navigation"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
