
export const pluginUiModule = {
  id: "plugin-ui",
  requires: ["services", "ui", "shared", "mcp-apps-protocol", "plugin-ui-bridge", "plugin-sandbox"],
  provides: ["plugin-ui-components"],
  publicEntrypoints: ["index.ts", "contract.ts", "hostPrimitives.ts"],
} as const;
