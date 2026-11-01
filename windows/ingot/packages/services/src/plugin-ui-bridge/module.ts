
export const pluginUiBridgeModule = {
  id: "plugin-ui-bridge",
  requires: ["services", "shared", "mcp-apps-protocol"],
  provides: ["plugin-ui-bridge-service"],
  publicEntrypoints: ["index.ts", "contract.ts", "appToolsContract.ts", "samplingContract.ts"],
} as const;
