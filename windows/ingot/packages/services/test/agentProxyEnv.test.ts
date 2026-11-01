import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createOfficialMcpTrustedOriginRegistry,
  resolveRuntimeCfEndpointOrigin,
} from "@origin-ai/cf-shared";
import {
  buildAgentCaCertEnv,
  buildAgentEndpointOriginEnv,
  buildAgentNoProxyEnv,
  buildAgentProxyEnv,
  buildAgentRuntimeEnv,
  buildAgentWorkspaceIdentityEnv,
} from "../src/runtime-tools/agentProxyEnv.js";

describe("buildAgentProxyEnv", () => {
  it("returns an empty patch when no proxy is configured", () => {
    expect(buildAgentProxyEnv(undefined)).toEqual({});
    expect(buildAgentProxyEnv("")).toEqual({});
    expect(buildAgentProxyEnv("   ")).toEqual({});
  });

  it("sets the standard uppercase proxy keys plus CF_HTTP_PROXY", () => {
    expect(buildAgentProxyEnv("http://127.0.0.1:7890")).toEqual({
      HTTP_PROXY: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      ALL_PROXY: "http://127.0.0.1:7890",
      CF_HTTP_PROXY: "http://127.0.0.1:7890",
    });
  });

  it("prepends http:// to a bare host:port", () => {
    expect(buildAgentProxyEnv("127.0.0.1:7890").HTTP_PROXY).toBe("http://127.0.0.1:7890");
  });

  it("preserves an explicit scheme such as socks5", () => {
    expect(buildAgentProxyEnv("socks5://127.0.0.1:1080").ALL_PROXY).toBe("socks5://127.0.0.1:1080");
  });
});

describe("buildAgentCaCertEnv", () => {
  it("returns an empty patch without a cert path", () => {
    expect(buildAgentCaCertEnv(undefined)).toEqual({});
    expect(buildAgentCaCertEnv("  ")).toEqual({});
  });

  it("sets NODE_EXTRA_CA_CERTS and CF_AGENT_CA_CERT to the cert path", () => {
    expect(buildAgentCaCertEnv("/tmp/cf-network-ca.pem")).toEqual({
      NODE_EXTRA_CA_CERTS: "/tmp/cf-network-ca.pem",
      CF_AGENT_CA_CERT: "/tmp/cf-network-ca.pem",
    });
  });
});

describe("buildAgentNoProxyEnv", () => {
  it("returns an empty patch without bypass rules", () => {
    expect(buildAgentNoProxyEnv(undefined)).toEqual({});
    expect(buildAgentNoProxyEnv("  ")).toEqual({});
  });

  it("sets standard no-proxy keys plus CF_NO_PROXY", () => {
    expect(buildAgentNoProxyEnv(" localhost, 127.0.0.1 ,.example.com ")).toEqual({
      NO_PROXY: "localhost,127.0.0.1,.example.com",
      no_proxy: "localhost,127.0.0.1,.example.com",
      CF_NO_PROXY: "localhost,127.0.0.1,.example.com",
    });
  });
});

describe("buildAgentRuntimeEnv", () => {
  it("merges proxy, no-proxy and the configured CA cert", () => {
    expect(
      buildAgentRuntimeEnv({
        httpProxy: "http://127.0.0.1:7890",
        noProxy: "localhost,127.0.0.1",
        caCertPath: "/tmp/root-ca.pem",
      }),
    ).toEqual({
      HTTP_PROXY: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      ALL_PROXY: "http://127.0.0.1:7890",
      CF_HTTP_PROXY: "http://127.0.0.1:7890",
      NO_PROXY: "localhost,127.0.0.1",
      no_proxy: "localhost,127.0.0.1",
      CF_NO_PROXY: "localhost,127.0.0.1",
      NODE_EXTRA_CA_CERTS: "/tmp/root-ca.pem",
      CF_AGENT_CA_CERT: "/tmp/root-ca.pem",
    });
  });

  it("injects no CA when the setting is empty, even if proxy is configured", () => {
    expect(buildAgentRuntimeEnv({ httpProxy: "http://127.0.0.1:7890" })).toEqual({
      HTTP_PROXY: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      ALL_PROXY: "http://127.0.0.1:7890",
      CF_HTTP_PROXY: "http://127.0.0.1:7890",
    });
  });

  it("injects the configured CA even without a proxy", () => {
    expect(
      buildAgentRuntimeEnv({ httpProxy: undefined, caCertPath: " /tmp/root-ca.pem " }),
    ).toEqual({
      NODE_EXTRA_CA_CERTS: "/tmp/root-ca.pem",
      CF_AGENT_CA_CERT: "/tmp/root-ca.pem",
    });
  });
});

describe("buildAgentEndpointOriginEnv", () => {
  it("returns an empty patch when the origin is missing or blank", () => {
    expect(buildAgentEndpointOriginEnv(undefined)).toEqual({});
    expect(buildAgentEndpointOriginEnv("")).toEqual({});
    expect(buildAgentEndpointOriginEnv("   ")).toEqual({});
  });

  it("pins the resolved origin onto CF_BASE_URL", () => {
    expect(buildAgentEndpointOriginEnv("https://cf.z.ai")).toEqual({
      CF_BASE_URL: "https://cf.z.ai",
    });
  });

  it("outranks the inherited endpoint keys it must override", () => {
    const hostEnv = {
      CF_ENDPOINT_ORIGIN: "https://inherited-endpoint.example",
      CF_ENV: "test",
      CF_TEST_BASE_URL: "https://inherited-test.example",
    };
    const agentEnv = {
      ...hostEnv,
      ...buildAgentEndpointOriginEnv("https://authoritative.example"),
    };

    expect(resolveRuntimeCfEndpointOrigin(agentEnv)).toBe("https://authoritative.example");
  });
});

describe("buildAgentWorkspaceIdentityEnv", () => {
  it("injects only a trimmed remote workspace identity", () => {
    expect(buildAgentWorkspaceIdentityEnv(" remote:ssh:host:/repo ")).toEqual({
      CF_WORKSPACE_IDENTITY: "remote:ssh:host:/repo",
    });
    expect(buildAgentWorkspaceIdentityEnv("   ")).toEqual({});
    expect(buildAgentWorkspaceIdentityEnv(undefined)).toEqual({});
  });
});

describe("official MCP trust: host and agent must agree on the CodeFusion API origin", () => {
  const SETTINGS_ORIGIN = "https://custom-endpoint.example";
  const PLUGIN_ID = "official-tools@cf-plugins-local";

  
  function hostRegistry(env: Record<string, string>, overrideOrigin: string | undefined) {
    return createOfficialMcpTrustedOriginRegistry({
      resolveCfApiOrigin: () => resolveRuntimeCfEndpointOrigin(env, { overrideOrigin }),
    });
  }

  
  function agentRegistry(env: Record<string, string>) {
    return createOfficialMcpTrustedOriginRegistry({
      resolveCfApiOrigin: () => resolveRuntimeCfEndpointOrigin(env),
    });
  }

  async function verdict(
    registry: ReturnType<typeof createOfficialMcpTrustedOriginRegistry>,
    origin: string,
  ) {
    return (await registry.isTrusted({ mcpKey: "image_search", origin, pluginId: PLUGIN_ID }))
      .trusted;
  }

  it("agrees in test env once the resolved origin is injected", async () => {
    const hostEnv = { CF_ENV: "test", CF_BASE_URL: "https://env-derived.example" };
    const agentEnv = {
      ...hostEnv,
      ...buildAgentEndpointOriginEnv(
        resolveRuntimeCfEndpointOrigin(hostEnv, { overrideOrigin: SETTINGS_ORIGIN }),
      ),
    };
    const host = hostRegistry(hostEnv, SETTINGS_ORIGIN);
    const agent = agentRegistry(agentEnv);

    for (const origin of [
      SETTINGS_ORIGIN,
      "https://env-derived.example",
      "https://attacker.example",
    ]) {
      expect(await verdict(agent, origin)).toBe(await verdict(host, origin));
    }
    expect(await verdict(host, SETTINGS_ORIGIN)).toBe(true);
    expect(await verdict(agent, SETTINGS_ORIGIN)).toBe(true);
  });

  it("would diverge without the injection (guards against silently dropping it)", async () => {
    const hostEnv = { CF_ENV: "test", CF_BASE_URL: "https://env-derived.example" };
    const host = hostRegistry(hostEnv, SETTINGS_ORIGIN);
    const agentWithoutInjection = agentRegistry(hostEnv);

    expect(await verdict(host, SETTINGS_ORIGIN)).toBe(true);
    expect(await verdict(agentWithoutInjection, SETTINGS_ORIGIN)).toBe(false);
  });

  it("agrees in production, where the settings override is ignored on both sides", async () => {
    const hostEnv = { CF_ENV: "production", CF_BASE_URL: "https://cf.z.ai" };
    const injected = resolveRuntimeCfEndpointOrigin(hostEnv, {
      overrideOrigin: SETTINGS_ORIGIN,
    });
    expect(injected).toBe("https://cf.z.ai");

    const agentEnv = { ...hostEnv, ...buildAgentEndpointOriginEnv(injected) };
    const host = hostRegistry(hostEnv, SETTINGS_ORIGIN);
    const agent = agentRegistry(agentEnv);

    for (const origin of ["https://cf.z.ai", SETTINGS_ORIGIN]) {
      expect(await verdict(agent, origin)).toBe(await verdict(host, origin));
    }
    expect(await verdict(host, "https://cf.z.ai")).toBe(true);
    expect(await verdict(host, SETTINGS_ORIGIN)).toBe(false);
  });
});

describe("node.ts wires the authoritative origin into resolveSpawnEnv", () => {
  const source = readFileSync(resolve(process.cwd(), "packages/services/src/node.ts"), "utf8");
  const spawnEnvStart = source.indexOf("resolveSpawnEnv: async (");
  const spawnEnvBlock = source.slice(
    spawnEnvStart,
    source.indexOf("...buildAgentTelemetrySpawnEnv({", spawnEnvStart),
  );

  it("feeds it the settings-aware resolver, not the env-only one", () => {
    expect(spawnEnvBlock).toContain(
      "buildAgentEndpointOriginEnv(await resolveCurrentCfEndpointOrigin())",
    );
  });
});
