
export const pluginSandboxModule = {
  id: "plugin-sandbox",
  requires: ["desktop", "shared", "mcp-apps-protocol", "gen-ui-protocol"],
  provides: ["plugin-sandbox-registry", "plugin-sandbox-platform"],
  publicEntrypoints: ["index.ts", "contract.ts", "aliasRuntime.ts", "aliasApi.ts"],
} as const;
