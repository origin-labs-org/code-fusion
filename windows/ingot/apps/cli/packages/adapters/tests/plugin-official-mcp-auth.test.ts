
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNodePluginAdapter } from "../src/plugins/index.js";

const PLUGIN_NAME = "official-mcp-plugin";
const MCP_KEY = "fake-official-search";
const RUNTIME_NAME = `plugin:${PLUGIN_NAME}:${MCP_KEY}`;

interface DiscoverOutcome {
  diagnostics: Array<{ code: string; message: string }>;
  mcpServers: Record<string, Record<string, unknown>>;
}

async function discoverWithMcpServer(server: Record<string, unknown>): Promise<{
  cleanup: () => Promise<void>;
  outcome: DiscoverOutcome;
}> {
  const dir = await mkdtemp(join(tmpdir(), "cf-official-mcp-plugin-"));
  const pluginRoot = join(dir, PLUGIN_NAME);
  await mkdir(join(pluginRoot, ".cf-plugin"), { recursive: true });
  await writeFile(
    join(pluginRoot, ".cf-plugin", "plugin.json"),
    JSON.stringify({ name: PLUGIN_NAME }),
  );
  await writeFile(
    join(pluginRoot, ".mcp.json"),
    JSON.stringify({ mcpServers: { [MCP_KEY]: server } }),
  );

  const outcome = (await createNodePluginAdapter({
    storageRoot: join(dir, "plugins"),
  }).discoverPlugins({
    config: { dirs: [pluginRoot], enabled: true, enabledPlugins: {}, options: {} },
    env: {},
    storageRoot: join(dir, "plugins"),
    workingDirectory: dir,
  })) as unknown as DiscoverOutcome;

  return { cleanup: () => rm(dir, { force: true, recursive: true }), outcome };
}

function expectDisabled(outcome: DiscoverOutcome): void {
  expect(outcome.mcpServers[RUNTIME_NAME]).toBeUndefined();
  expect(outcome.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "plugin_mcp_server_disabled",
  );
}

describe("plugin mcp cf_official auth parsing", () => {
  it("OMCP-001: keeps auth and host-generated provenance for a valid http declaration", async () => {
    const { cleanup, outcome } = await discoverWithMcpServer({
      auth: { provider: "jwt_token", type: "cf_official" },
      timeoutMs: 30_000,
      type: "http",
      url: "https://mcp.cf.example/mcp",
    });
    try {
      expect(outcome.mcpServers[RUNTIME_NAME]).toMatchObject({
        auth: { provider: "jwt_token", type: "cf_official" },
        official: { mcpKey: MCP_KEY, source: "plugin" },
        type: "http",
        url: "https://mcp.cf.example/mcp",
      });
      const official = outcome.mcpServers[RUNTIME_NAME]?.official as { pluginId: string };
      expect(official.pluginId).toContain(PLUGIN_NAME);
    } finally {
      await cleanup();
    }
  });

  it("OMCP-002: ignores an official field forged in .mcp.json", async () => {
    const { cleanup, outcome } = await discoverWithMcpServer({
      auth: { provider: "jwt_token", type: "cf_official" },
      official: { mcpKey: "spoofed", pluginId: "cf-tools@official", source: "plugin" },
      type: "http",
      url: "https://mcp.cf.example/mcp",
    });
    try {
      const official = outcome.mcpServers[RUNTIME_NAME]?.official as {
        mcpKey: string;
        pluginId: string;
      };
      expect(official.mcpKey).toBe(MCP_KEY);
      expect(official.pluginId).not.toBe("cf-tools@official");
    } finally {
      await cleanup();
    }
  });

  it("rejects alias and casing variants of the auth type", async () => {
    for (const type of ["cf-official_auth", "cf-official", "CF_OFFICIAL", "Cf_Official"]) {
      const { cleanup, outcome } = await discoverWithMcpServer({
        auth: { provider: "jwt_token", type },
        type: "http",
        url: "https://mcp.cf.example/mcp",
      });
      try {
        expectDisabled(outcome);
      } finally {
        await cleanup();
      }
    }
  });

  it("rejects an unsupported auth provider", async () => {
    const { cleanup, outcome } = await discoverWithMcpServer({
      auth: { provider: "short_lived_token", type: "cf_official" },
      type: "http",
      url: "https://mcp.cf.example/mcp",
    });
    try {
      expectDisabled(outcome);
    } finally {
      await cleanup();
    }
  });

  it("OMCP-S07: keeps auth and host-generated provenance for a valid stdio declaration", async () => {
    const { cleanup, outcome } = await discoverWithMcpServer({
      auth: { provider: "jwt_token", type: "cf_official" },
      command: "python3",
      type: "stdio",
    });
    try {
      expect(outcome.mcpServers[RUNTIME_NAME]).toMatchObject({
        auth: { provider: "jwt_token", type: "cf_official" },
        official: { mcpKey: MCP_KEY, source: "plugin" },
        type: "stdio",
      });
      const official = outcome.mcpServers[RUNTIME_NAME]?.official as { pluginId: string };
      expect(official.pluginId).toContain(PLUGIN_NAME);
    } finally {
      await cleanup();
    }
  });

  it("OMCP-S08: ignores an official field forged in a stdio declaration", async () => {
    const { cleanup, outcome } = await discoverWithMcpServer({
      auth: { provider: "jwt_token", type: "cf_official" },
      command: "python3",
      official: { mcpKey: "spoofed", pluginId: "cf-tools@official", source: "plugin" },
      type: "stdio",
    });
    try {
      const official = outcome.mcpServers[RUNTIME_NAME]?.official as {
        mcpKey: string;
        pluginId: string;
      };
      expect(official.mcpKey).toBe(MCP_KEY);
      expect(official.pluginId).not.toBe("cf-tools@official");
    } finally {
      await cleanup();
    }
  });

  it("OMCP-S09: rejects cf_official combined with oauth on stdio", async () => {
    const { cleanup, outcome } = await discoverWithMcpServer({
      auth: { provider: "jwt_token", type: "cf_official" },
      command: "python3",
      oauth: { type: "authorization_code" },
      type: "stdio",
    });
    try {
      expectDisabled(outcome);
    } finally {
      await cleanup();
    }
  });

  it("rejects cf_official on the sse transport", async () => {
    const sse = await discoverWithMcpServer({
      auth: { provider: "jwt_token", type: "cf_official" },
      type: "sse",
      url: "https://mcp.cf.example/sse",
    });
    try {
      expectDisabled(sse.outcome);
    } finally {
      await sse.cleanup();
    }
  });

  it("OMCP-018: rejects cf_official combined with oauth", async () => {
    const { cleanup, outcome } = await discoverWithMcpServer({
      auth: { provider: "jwt_token", type: "cf_official" },
      oauth: { type: "authorization_code" },
      type: "http",
      url: "https://mcp.cf.example/mcp",
    });
    try {
      expectDisabled(outcome);
    } finally {
      await cleanup();
    }
  });

  it("OMCP-007 / OMCP-020: rejects reserved identity and protocol headers, case-insensitively", async () => {
    const reserved = [
      "authorization",
      "AUTHORIZATION",
      "x-coding-plan-api-key",
      "X-Coding-Plan-Api-Key",
      "x-bigmodel-authorization",
      "bigmodel-target-type",
      "Bigmodel-Organization",
      "bigmodel-project",
      "mcp-session-id",
      "MCP-Protocol-Version",
    ];
    for (const header of reserved) {
      const { cleanup, outcome } = await discoverWithMcpServer({
        auth: { provider: "jwt_token", type: "cf_official" },
        headers: { [header]: "attacker-supplied" },
        type: "http",
        url: "https://mcp.cf.example/mcp",
      });
      try {
        expectDisabled(outcome);
      } finally {
        await cleanup();
      }
    }
  });

  it("keeps non-reserved static headers alongside official auth", async () => {
    const { cleanup, outcome } = await discoverWithMcpServer({
      auth: { provider: "jwt_token", type: "cf_official" },
      headers: { "x-trace-hint": "keep-me" },
      type: "http",
      url: "https://mcp.cf.example/mcp",
    });
    try {
      expect(outcome.mcpServers[RUNTIME_NAME]?.headers).toEqual({ "x-trace-hint": "keep-me" });
    } finally {
      await cleanup();
    }
  });

  it("OMCP-019: leaves ordinary http MCP untouched, including a static authorization header", async () => {
    const { cleanup, outcome } = await discoverWithMcpServer({
      headers: { authorization: "Bearer third-party-token" },
      type: "http",
      url: "https://third-party.example/mcp",
    });
    try {
      expect(outcome.mcpServers[RUNTIME_NAME]).toMatchObject({
        headers: { authorization: "Bearer third-party-token" },
        type: "http",
      });
      expect(outcome.mcpServers[RUNTIME_NAME]?.auth).toBeUndefined();
      expect(outcome.mcpServers[RUNTIME_NAME]?.official).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
