
export const projectWorkflowModule = {
  id: "project-workflow",
  requires: ["shared", "ui", "project-sidebar"],
  provides: ["project-workflow"],
  publicEntrypoints: [
    "contract.ts",
    "useWorkflowRunSave.ts",
    "WorkflowRunSaveControls.tsx",
    "WorkflowRunPaneSaveSlots.tsx",
  ],
} as const;
