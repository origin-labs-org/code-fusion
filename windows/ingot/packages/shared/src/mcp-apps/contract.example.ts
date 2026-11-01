import type { McpToolUiDescriptor, PluginSandboxHandle } from "./contract.js";
import {
  MCP_APPS_CSP_RELAXATION_META_KEY,
  MCP_APPS_SET_WIDGET_STATE_METHOD,
  PLUGIN_SANDBOX_PORT_NAME,
  buildMcpAppsClientCapabilities,
  buildMcpAppsCspExperimentalCapability,
} from "./contract.js";

export const exampleToolUiDescriptor: McpToolUiDescriptor = {
  resourceUri: "ui://example-plugin/widget.html",
  visibility: ["model", "app"],
  preferredDisplayMode: "inline",
  csp: { connectDomains: ["https://api.example.com"], resourceDomains: [] },
  prefersBorder: true,
};

export const exampleSandboxHandle: PluginSandboxHandle = {
  instance: {
    runtimeId: "test-agent",
    generation: 1,
    token: "test-token",
    appIdentity: "a".repeat(64),
  },
  sandboxId: "sb-01",
  initId: 1,
  shellUrl: "cf-sandbox://shell-sb-01/",
  partition: "persist:plugin-sandbox-v1-0123456789abcdef",
  resourceMeta: {
    prefersBorder: true,
    heightHint: 320,
    minFrameHeight: 120,
    showInline: false,
    permissions: ["clipboardWrite"],
  },
};

export const exampleClientCapabilities = buildMcpAppsClientCapabilities();

export const exampleCspExperimental = buildMcpAppsCspExperimentalCapability();

export const exampleResourceMetaWithRelaxations = {
  ui: { csp: { connectDomains: ["https://api.example.com"] } },
  [MCP_APPS_CSP_RELAXATION_META_KEY]: { unsafeEval: true },
};
export const exampleSetWidgetStateMethod = MCP_APPS_SET_WIDGET_STATE_METHOD;
export const examplePortName = PLUGIN_SANDBOX_PORT_NAME;
