
export const mcpUiModule = {
  id: "mcp-ui",
  requires: ["cf-cli", "shared", "mcp-apps-protocol"],
  provides: ["mcp-ui-handlers"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
