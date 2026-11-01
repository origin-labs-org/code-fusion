import type { PluginSandboxRegistryPort } from "./contract.js";
import { buildPluginSandboxPartition, buildPluginSandboxShellUrl } from "./contract.js";

export function exampleRegister(registry: PluginSandboxRegistryPort) {
  const serverName = "plugin:example-plugin:widget";
  const handle = registry.register({
    instance: {
      runtimeId: "example",
      generation: 1,
      token: "example",
      appIdentity: "a".repeat(64),
    },
    ownerWebContentsId: 1,
    workspacePath: "/repo",
    sessionId: "session_1",
    pluginId: "example-plugin@example-marketplace",
    serverName,
    scopeId: "tool:call_1",
    html: "<!doctype html><p>widget</p>",
    csp: { connectDomains: ["https://api.example.com"] },
    cspRelaxations: { wasmUnsafeEval: true },
  });
  return {
    handle,
    shellUrlMatches:
      handle.shellUrl === buildPluginSandboxShellUrl(handle.sandboxId, handle.instance.appIdentity),
    partitionMatches:
      handle.partition ===
      buildPluginSandboxPartition({ appIdentity: handle.instance.appIdentity }),
  };
}
