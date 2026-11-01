
export const cliSessionExecutionModule = {
  id: "cli-session-execution",
  requires: ["shared", "cf-cli"],
  provides: ["cli-session-execution"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
