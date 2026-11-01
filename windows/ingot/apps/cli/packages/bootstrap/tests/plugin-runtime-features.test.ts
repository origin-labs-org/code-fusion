import { describe, expect, it } from "vitest";
import type { PluginLoadOutcome, PluginMetadata } from "@origin-ai/cf-contracts";
import { resolvePluginRuntimeFeatures } from "../src/app/plugin-runtime-features.js";
import { resolveBuiltInNodeReplMcpServers } from "../src/app/built-in-node-repl.js";

function plugin(id: string, enabled: boolean, rootPath = "/tmp/plugin"): PluginMetadata {
  const [name = id, marketplace = "test"] = id.split("@");
  return {
    commandRootCount: 0,
    components: [],
    dataPath: "/tmp/plugin-data",
    declaredMcpServerNames: [],
    enabled,
    hookDetails: [],
    id,
    manifestPath: `${rootPath}/.cf-plugin/plugin.json`,
    marketplace,
    mcpServerNames: [],
    name,
    rootPath,
    skillCount: 0,
    skillRootCount: 0,
    source: "official",
  };
}

function outcome(plugins: PluginMetadata[]): Pick<PluginLoadOutcome, "plugins"> {
  return { plugins };
}

describe("resolvePluginRuntimeFeatures", () => {
  it("enables browser-use without exposing the legacy core node_repl tools", () => {
    expect(
      resolvePluginRuntimeFeatures(outcome([plugin("browser-use@cf-plugins-official", true)])),
    ).toEqual({
      browserUse: true,
      browserDocumentationRoot: "/tmp/plugin/docs",
    });
  });

  it("exposes only the stateless modern node_repl runtime, served from the host root", () => {
    const enabledServers = resolveBuiltInNodeReplMcpServers({
      pluginOutcome: outcome([
        plugin("node-repl-host@cf-plugins-official", true, "/tmp/host"),
        plugin("browser-use@cf-plugins-official", true),
      ]),
      workingDirectory: "/workspace",
    });
    expect(enabledServers.node_repl).toMatchObject({
      command: process.execPath,
      cwd: "/workspace",
      env: { ELECTRON_RUN_AS_NODE: "1", CF_PLUGIN_ROOT: "/tmp/plugin" },
      timeoutMs: 600_000,
      isolation: "workspace",
      protocolVersion: "2026-07-28",
      type: "stdio",
    });
    expect(
      enabledServers.node_repl?.type === "stdio"
        ? enabledServers.node_repl.args?.at(-1)
        : undefined,
    ).toBe("/tmp/host/dist/mcp/server.js");
    expect(enabledServers.browser_use).toBeUndefined();
  });

  it("does not register node_repl when the shared host is missing", () => {
    expect(
      resolveBuiltInNodeReplMcpServers({
        pluginOutcome: outcome([plugin("browser-use@cf-plugins-official", true)]),
        workingDirectory: "/workspace",
      }),
    ).toEqual({});
  });

  it("serves Computer Use without the Browser Use package", () => {
    const servers = resolveBuiltInNodeReplMcpServers({
      pluginOutcome: outcome([
        plugin("node-repl-host@cf-plugins-official", true, "/tmp/host"),
        plugin("computer-use@cf-plugins-official", true, "/tmp/cua-plugin"),
      ]),
      workingDirectory: "/workspace",
    });
    expect(servers.node_repl).toMatchObject({
      env: { CF_CUA_PLUGIN_ROOT: "/tmp/cua-plugin" },
      type: "stdio",
    });
    expect(
      servers.node_repl?.type === "stdio" ? servers.node_repl.env?.CF_PLUGIN_ROOT : undefined,
    ).toBeUndefined();
  });

  it("enables the CUA SDK without registering core node_repl tools", () => {
    expect(
      resolvePluginRuntimeFeatures(outcome([plugin("computer-use@cf-plugins-official", true)])),
    ).toEqual({ computerUse: true });
  });

  it("does not register node_repl when the browser-use plugin is disabled", () => {
    expect(
      resolveBuiltInNodeReplMcpServers({
        pluginOutcome: outcome([
          plugin("node-repl-host@cf-plugins-official", true, "/tmp/host"),
          plugin("browser-use@cf-plugins-official", false),
        ]),
        workingDirectory: "/workspace",
      }),
    ).toEqual({});
  });

  it("keeps the shared host and CUA runtime roots separate", () => {
    const servers = resolveBuiltInNodeReplMcpServers({
      pluginOutcome: outcome([
        plugin("node-repl-host@cf-plugins-official", true, "/tmp/host"),
        plugin("browser-use@cf-plugins-official", false, "/tmp/browser-plugin"),
        plugin("computer-use@cf-plugins-official", true, "/tmp/cua-plugin"),
      ]),
      workingDirectory: "/workspace",
    });

    expect(servers.node_repl).toMatchObject({
      env: { CF_CUA_PLUGIN_ROOT: "/tmp/cua-plugin" },
      type: "stdio",
    });
    expect(
      servers.node_repl?.type === "stdio" ? servers.node_repl.env?.CF_PLUGIN_ROOT : undefined,
    ).toBeUndefined();
  });

  it("does not register node_repl when the browser-use plugin is absent", () => {
    expect(
      resolveBuiltInNodeReplMcpServers({
        pluginOutcome: outcome([plugin("browser@third-party", true)]),
        workingDirectory: "/workspace",
      }),
    ).toEqual({});
  });

  it("keeps browser-use disabled for disabled or non-official plugins", () => {
    expect(
      resolvePluginRuntimeFeatures(outcome([plugin("browser-use@cf-plugins-official", false)])),
    ).toEqual({});
    expect(resolvePluginRuntimeFeatures(outcome([plugin("browser@third-party", true)]))).toEqual(
      {},
    );
  });
});
