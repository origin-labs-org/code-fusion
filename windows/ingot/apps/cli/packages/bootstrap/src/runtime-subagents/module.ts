
export const cliSubagentConfigModule = {
  id: "cli-subagent-config",
  requires: ["shared"],
  provides: ["cli-subagent-config"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
