
export const taskGroupsModule = {
  id: "task-groups",
  requires: ["services", "session", "shared"],
  provides: ["task-groups"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
