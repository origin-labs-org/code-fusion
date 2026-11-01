import { describe, expect, it } from "vitest";
import { exampleRegister } from "./contract.example.js";
import type { PluginSandboxRegistryPort } from "./contract.js";
import {
  PLUGIN_SANDBOX_PARTITION_PREFIX,
  buildPluginSandboxPartition,
  buildPluginSandboxPluginOrigin,
  buildPluginSandboxShellUrl,
} from "./contract.js";

describe("plugin-sandbox contract", () => {
  it("shell 与插件 iframe 落在不同 origin", () => {
    expect(buildPluginSandboxShellUrl("sb-1", "trusted")).toBe(
      "cf-sandbox://shell-trusted/instance/sb-1/",
    );
    expect(buildPluginSandboxPluginOrigin("sb-1")).toBe("cf-sandbox://plugin-sb-1");
  });

  it("Partition derived by trusted App identity, isolating workspaces across all origins", () => {
    const plugin = buildPluginSandboxPartition({ appIdentity: "source-a" });
    expect(plugin.startsWith(PLUGIN_SANDBOX_PARTITION_PREFIX)).toBe(true);
    expect(plugin).not.toBe(buildPluginSandboxPartition({ appIdentity: "source-b" }));
    expect(buildPluginSandboxPartition({ appIdentity: "source-a" })).not.toBe(
      buildPluginSandboxPartition({ appIdentity: "source-b" }),
    );
  });

  it("示例注册表实现满足派生规则", () => {
    const registry: PluginSandboxRegistryPort = {
      register: (input) => ({
        instance: input.instance,
        sandboxId: input.scopeId,
        initId: 1,
        shellUrl: buildPluginSandboxShellUrl(input.scopeId, input.instance.appIdentity),
        partition: buildPluginSandboxPartition({
          appIdentity: input.instance.appIdentity,
        }),
      }),
      get: () => null,
      dispose: () => {},
      disposeOwner: () => {},
      pin: () => {},
      unpin: () => {},
      markUserGesture: () => {},
      consumeUserGesture: () => false,
    };
    const result = exampleRegister(registry);
    expect(result.shellUrlMatches).toBe(true);
    expect(result.partitionMatches).toBe(true);
  });
});
