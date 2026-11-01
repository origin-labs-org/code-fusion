
export const workflowToolEntrypointsModule = {
  id: "workflow-tool-entrypoints",
  requires: ["cf-cli"],
  provides: ["workflow-tool-entrypoints"],
  publicEntrypoints: [
    "../handlers/amend-workflow.ts",
    "../handlers/list-models.ts",
    "../handlers/fill-workflow-hole.ts",
    "contract.ts",
  ],
} as const;
