
export const taskFactsModule = {
  id: "task-facts",
  requires: ["shared"],
  provides: ["task-facts"],
  publicEntrypoints: ["index.ts", "contract.ts", "repairSubagentTaskIndex.ts"],
} as const;
