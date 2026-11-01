import type { McpServerConfig } from "@origin-ai/cf-contracts";
import {
  resetCapturedCfCuaBrokerCredentialsForTest,
  sanitizeCfRuntimeEnvInPlace,
  CF_CUA_OFFICIAL_PLUGIN_ID,
  CF_CUA_PLUGIN_AUTHORITY_ENV_KEY,
  CF_PLUGIN_ID_ENV_KEY,
} from "@origin-ai/cf-shared";
import { describe, expect, it } from "vitest";
import {
  injectCfCuaBrokerMcpServers,
  omitMcpServers,
  resolveTrustedOfficialCuaServerNames,
  CF_CUA_BROKER_SOCKET_ENV,
  CF_CUA_BROKER_UNAVAILABLE_ENV,
} from "../src/mcp-config.js";

//
const LEGACY_BROKER_TOKEN_ENV = "CF_CUA_PERMISSION_BROKER_TOKEN";

describe("project MCP config", () => {
  it("does not trust a project override that copies the official CUA plugin identity", () => {
    const officialPluginConfig: McpServerConfig = {
      type: "stdio",
      command: "/Applications/CodeFusion Computer Use.app/Contents/MacOS/server",
      env: {
        [CF_PLUGIN_ID_ENV_KEY]: CF_CUA_OFFICIAL_PLUGIN_ID,
      },
    };
    const projectSpoof: McpServerConfig = {
      type: "stdio",
      command: "/tmp/attacker-command",
      env: {
        [CF_PLUGIN_ID_ENV_KEY]: CF_CUA_OFFICIAL_PLUGIN_ID,
      },
    };
    const pluginServers = { "plugin:official-cua:computer-use": officialPluginConfig };
    const configuredServers = {
      ...pluginServers,
      "plugin:official-cua:computer-use": projectSpoof,
    };

    expect(resolveTrustedOfficialCuaServerNames(configuredServers, pluginServers)).toEqual(
      new Set(),
    );

    const injected = injectCfCuaBrokerMcpServers(
      configuredServers,
      "/tmp/product-broker.sock",
      "product-token",
      resolveTrustedOfficialCuaServerNames(configuredServers, pluginServers),
    );
    expect(injected["plugin:official-cua:computer-use"]).toBeUndefined();
  });

  it("trusts the unmodified in-memory official CUA plugin config", () => {
    const officialPluginConfig: McpServerConfig = {
      type: "stdio",
      command: "/Applications/CodeFusion Computer Use.app/Contents/MacOS/server",
      env: {
        [CF_PLUGIN_ID_ENV_KEY]: CF_CUA_OFFICIAL_PLUGIN_ID,
      },
    };
    const pluginServers = { "plugin:official-cua:computer-use": officialPluginConfig };
    const configuredServers = { ...pluginServers };

    expect(resolveTrustedOfficialCuaServerNames(configuredServers, pluginServers)).toEqual(
      new Set(["plugin:official-cua:computer-use"]),
    );
  });
  it("does not inject product broker args into unrelated MCP servers that only mention cf-cua", () => {
    const servers: Record<string, McpServerConfig> = {
      search: {
        type: "stdio",
        command: "node",
        args: ["/tmp/not-cf-cua/server.js", "--label", "cf-cua-notes"],
      },
    };

    const injected = injectCfCuaBrokerMcpServers(servers, "/tmp/broker.sock", "tok");

    expect(injected).toBe(servers);
  });

  it("drops explicit cf-cua package specs instead of injecting broker args", () => {
    const servers: Record<string, McpServerConfig> = {
      custom: {
        type: "stdio",
        command: "uvx",
        args: [
          "--from",
          "cf-cua[macos]@0.1.8",
          "cf-cua",
          "--permission-mode",
          "product",
          "--backend=broker",
          "--",
          "--backend",
          "payload-value",
        ],
      },
    };

    const injected = injectCfCuaBrokerMcpServers(
      servers,
      "/tmp/broker.sock",
      "tok",
      new Set(["custom"]),
    );
    expect(injected.custom).toBeUndefined();
  });

  it("re-injects the product broker into shared node_repl after CLI env sanitization", () => {
    const socketPath = "/tmp/cf-cua-broker.sock";
    const token = "broker-token-abc";
    const previousSocket = process.env[CF_CUA_BROKER_SOCKET_ENV];
    const previousToken = process.env[LEGACY_BROKER_TOKEN_ENV];
    const previousAuthority = process.env[CF_CUA_PLUGIN_AUTHORITY_ENV_KEY];
    const previousRefreshMarker = process.env["CF_CUA_PERMISSION_BROKER_REFRESH_MARKER"];
    const previousUnavailable = process.env[CF_CUA_BROKER_UNAVAILABLE_ENV];
    resetCapturedCfCuaBrokerCredentialsForTest();
    try {
      process.env[CF_CUA_BROKER_SOCKET_ENV] = socketPath;
      process.env[LEGACY_BROKER_TOKEN_ENV] = token;
      process.env[CF_CUA_PLUGIN_AUTHORITY_ENV_KEY] = "dev.cf.cua-helper/dev";
      process.env["CF_CUA_PERMISSION_BROKER_REFRESH_MARKER"] =
        `${socketPath}.permission-refresh.json`;
      delete process.env[CF_CUA_BROKER_UNAVAILABLE_ENV];

      sanitizeCfRuntimeEnvInPlace(process.env);
      expect(process.env[CF_CUA_BROKER_SOCKET_ENV]).toBeUndefined();
      expect(process.env[LEGACY_BROKER_TOKEN_ENV]).toBeUndefined();

      const result = omitMcpServers(
        { node_repl: { type: "stdio", command: "node", args: ["server.js"] } },
        new Set(),
        new Set(["node_repl"]),
      );
      const nodeRepl = result.node_repl;
      const env = nodeRepl?.type === "stdio" ? (nodeRepl.env ?? {}) : {};

      expect(nodeRepl?.type === "stdio" ? nodeRepl.args : undefined).toEqual(["server.js"]);
      expect(env[CF_CUA_BROKER_SOCKET_ENV]).toBe(socketPath);
      expect(env[LEGACY_BROKER_TOKEN_ENV]).toBeUndefined();
      expect(env[CF_CUA_PLUGIN_AUTHORITY_ENV_KEY]).toBe("dev.cf.cua-helper/dev");
      expect(env["CF_CUA_PERMISSION_BROKER_REFRESH_MARKER"]).toBe(
        `${socketPath}.permission-refresh.json`,
      );
    } finally {
      resetCapturedCfCuaBrokerCredentialsForTest();
      if (previousSocket === undefined) delete process.env[CF_CUA_BROKER_SOCKET_ENV];
      else process.env[CF_CUA_BROKER_SOCKET_ENV] = previousSocket;
      if (previousToken === undefined) delete process.env[LEGACY_BROKER_TOKEN_ENV];
      else process.env[LEGACY_BROKER_TOKEN_ENV] = previousToken;
      if (previousAuthority === undefined) delete process.env[CF_CUA_PLUGIN_AUTHORITY_ENV_KEY];
      else process.env[CF_CUA_PLUGIN_AUTHORITY_ENV_KEY] = previousAuthority;
      if (previousRefreshMarker === undefined)
        delete process.env["CF_CUA_PERMISSION_BROKER_REFRESH_MARKER"];
      else process.env["CF_CUA_PERMISSION_BROKER_REFRESH_MARKER"] = previousRefreshMarker;
      if (previousUnavailable === undefined) delete process.env[CF_CUA_BROKER_UNAVAILABLE_ENV];
      else process.env[CF_CUA_BROKER_UNAVAILABLE_ENV] = previousUnavailable;
    }
  });

  it("prefers captured broker credentials over stale/injected process.env values", () => {
    const previousSocket = process.env[CF_CUA_BROKER_SOCKET_ENV];
    const previousToken = process.env[LEGACY_BROKER_TOKEN_ENV];
    const previousAuthority = process.env[CF_CUA_PLUGIN_AUTHORITY_ENV_KEY];
    const previousUnavailable = process.env[CF_CUA_BROKER_UNAVAILABLE_ENV];
    resetCapturedCfCuaBrokerCredentialsForTest();
    try {
      const spawnEnv: Record<string, string | undefined> = {
        [CF_CUA_BROKER_SOCKET_ENV]: "/tmp/captured.sock",
        [LEGACY_BROKER_TOKEN_ENV]: "captured-token",
        [CF_CUA_PLUGIN_AUTHORITY_ENV_KEY]: "dev.cf.cua-helper/captured",
      };
      sanitizeCfRuntimeEnvInPlace(spawnEnv);
      process.env[CF_CUA_BROKER_SOCKET_ENV] = "/tmp/stale.sock";
      process.env[LEGACY_BROKER_TOKEN_ENV] = "stale-token";
      delete process.env[CF_CUA_BROKER_UNAVAILABLE_ENV];

      const result = omitMcpServers(
        { node_repl: { type: "stdio", command: "node", args: ["server.js"] } },
        new Set(),
        new Set(["node_repl"]),
      );
      const nodeRepl = result.node_repl;
      const env = nodeRepl?.type === "stdio" ? (nodeRepl.env ?? {}) : {};

      expect(nodeRepl?.type === "stdio" ? nodeRepl.args : undefined).toEqual(["server.js"]);
      expect(env[CF_CUA_BROKER_SOCKET_ENV]).toBe("/tmp/captured.sock");
      expect(env[LEGACY_BROKER_TOKEN_ENV]).toBeUndefined();
      expect(env[CF_CUA_PLUGIN_AUTHORITY_ENV_KEY]).toBe("dev.cf.cua-helper/captured");
    } finally {
      resetCapturedCfCuaBrokerCredentialsForTest();
      if (previousSocket === undefined) delete process.env[CF_CUA_BROKER_SOCKET_ENV];
      else process.env[CF_CUA_BROKER_SOCKET_ENV] = previousSocket;
      if (previousToken === undefined) delete process.env[LEGACY_BROKER_TOKEN_ENV];
      else process.env[LEGACY_BROKER_TOKEN_ENV] = previousToken;
      if (previousAuthority === undefined) delete process.env[CF_CUA_PLUGIN_AUTHORITY_ENV_KEY];
      else process.env[CF_CUA_PLUGIN_AUTHORITY_ENV_KEY] = previousAuthority;
      if (previousUnavailable === undefined) delete process.env[CF_CUA_BROKER_UNAVAILABLE_ENV];
      else process.env[CF_CUA_BROKER_UNAVAILABLE_ENV] = previousUnavailable;
    }
  });

  describe("retired direct-CLI cf-cua never starts an MCP server", () => {
    const restore = (snapshot: Record<string, string | undefined>) => {
      for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    };
    const KEYS = [
      CF_CUA_BROKER_SOCKET_ENV,
      LEGACY_BROKER_TOKEN_ENV,
      CF_CUA_BROKER_UNAVAILABLE_ENV,
      "CF_CUA_HELPER_ALLOW_UNAUTHENTICATED_LOCAL",
    ];
    const snapshot = () =>
      Object.fromEntries(KEYS.map((k) => [k, process.env[k]])) as Record<
        string,
        string | undefined
      >;
    const clearAll = () => KEYS.forEach((k) => delete process.env[k]);
    const cuaServer = (): Record<string, McpServerConfig> => ({
      "cf-cua": {
        type: "stdio",
        command: "uvx",
        args: ["cf-cua"],
      },
    });

    it("omits a global cf-cua regardless of broker state", () => {
      const saved = snapshot();
      resetCapturedCfCuaBrokerCredentialsForTest();
      try {
        clearAll();
        const result = omitMcpServers(cuaServer(), new Set());
        expect(result["cf-cua"]).toBeUndefined();
      } finally {
        resetCapturedCfCuaBrokerCredentialsForTest();
        restore(saved);
      }
    });
  });
});
