
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OFFICIAL_MCP_AUTH_META_KEY } from "@origin-ai/cf-shared";
import type { McpServerConfig } from "@origin-ai/cf-contracts";

const {
  clientCallToolMock,
  clientConnectMock,
  clientListToolsMock,
  clientCloseMock,
  transportSendMock,
  transportCloseMock,
} = vi.hoisted(() => ({
  clientCallToolMock: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
  clientConnectMock: vi.fn(async () => {}),
  clientListToolsMock: vi.fn(async () => ({ tools: [] })),
  clientCloseMock: vi.fn(async () => {}),
  transportSendMock: vi.fn(async () => {}),
  transportCloseMock: vi.fn(async () => {}),
}));

vi.mock("@modelcontextprotocol/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@modelcontextprotocol/client")>();
  return {
    ...actual,
    Client: class {
      private transport?: { send(message: unknown): Promise<void> };
      readonly close = clientCloseMock;
      readonly ping = vi.fn(async () => ({}));
      onclose?: () => void;

      async connect(transport: { send(message: unknown): Promise<void> }) {
        this.transport = transport;
        await clientConnectMock(transport);
        await transport.send({ jsonrpc: "2.0", id: 0, method: "server/discover", params: {} });
        await transport.send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { capabilities: {}, clientInfo: { name: "test", version: "1" } },
        });
        await transport.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
      }

      async listTools() {
        await this.transport?.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        return await clientListToolsMock();
      }

      async callTool(params: Record<string, unknown>) {
        await this.transport?.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params });
        return await clientCallToolMock(params);
      }

      getProtocolEra() {
        return "modern";
      }

      getNegotiatedProtocolVersion() {
        return "2026-07-28";
      }
    },
  };
});

vi.mock("@modelcontextprotocol/client/stdio", () => ({
  StdioClientTransport: class {
    readonly close = transportCloseMock;
    readonly pid = 4242;
    readonly stderr = { on: vi.fn() };

    async send(message: unknown) {
      await transportSendMock(message);
    }
  },
}));

import { createMcpAdapter } from "../src/mcp/index.js";

const CF_ORIGIN = "https://cf.example";
const PLUGIN_ID = "video-agent-kit@cf-plugins-official";
const MCP_KEY = "video-edit";

const IDENTITY_HEADERS = {
  Authorization: "Bearer jwt-1",
  "Bigmodel-Organization": "org-1",
  "Bigmodel-Project": "project-1",
  "Bigmodel-Target-Type": "TEAM",
  "X-Bigmodel-Authorization": "Bearer maas-jwt-1",
};

function officialStdioConfig(): McpServerConfig {
  return {
    auth: { provider: "jwt_token", type: "cf_official" },
    command: "python3",
    official: { mcpKey: MCP_KEY, pluginId: PLUGIN_ID, source: "plugin" },
    type: "stdio",
  };
}

function lastWireMeta(method = "tools/call"): Record<string, unknown> | undefined {
  const sent = transportSendMock.mock.calls
    .map(
      ([message]) => message as { method?: string; params?: { _meta?: Record<string, unknown> } },
    )
    .filter((message) => message.method === method)
    .at(-1);
  return sent?.params?._meta;
}

describe("official stdio MCP auth via tools/call _meta", () => {
  beforeEach(() => {
    clientCallToolMock.mockClear();
    clientConnectMock.mockClear();
    clientListToolsMock.mockClear();
    transportSendMock.mockClear();
    clientCallToolMock.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    clientListToolsMock.mockResolvedValue({ tools: [] });
  });

  it("OMCP-S01: attaches the resolved identity headers for an official stdio server", async () => {
    const resolveHeaders = vi.fn(async () => ({ headers: IDENTITY_HEADERS, ok: true as const }));
    const isTrusted = vi.fn(async () => ({ trusted: true }));
    const adapter = createMcpAdapter({
      officialMcpAuth: {
        authHeadersPort: { resolveHeaders },
        resolveCfApiOrigin: () => CF_ORIGIN,
        trustedOrigins: { isTrusted },
      },
      workingDirectory: "/repo",
    });
    await adapter.connectServer("plugin:video-agent-kit:video-edit", officialStdioConfig());

    await adapter.callTool({
      arguments: { text: "你好" },
      serverName: "plugin:video-agent-kit:video-edit",
      toolName: "tts_generate",
    });

    for (const method of ["server/discover", "initialize", "notifications/initialized"]) {
      expect(lastWireMeta(method)?.[OFFICIAL_MCP_AUTH_META_KEY]).toEqual({
        headers: IDENTITY_HEADERS,
        ok: true,
      });
    }
    expect(lastWireMeta("tools/list")?.[OFFICIAL_MCP_AUTH_META_KEY]).toEqual({
      headers: IDENTITY_HEADERS,
      ok: true,
    });
    expect(lastWireMeta()?.[OFFICIAL_MCP_AUTH_META_KEY]).toEqual({
      headers: IDENTITY_HEADERS,
      ok: true,
    });
    expect(resolveHeaders).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpKey: MCP_KEY,
        pluginId: PLUGIN_ID,
        targetOrigin: CF_ORIGIN,
        workspacePath: "/repo",
      }),
    );
  });

  it("OMCP-S02: keeps trace context and identity headers side by side", async () => {
    const adapter = createMcpAdapter({
      officialMcpAuth: {
        authHeadersPort: {
          resolveHeaders: vi.fn(async () => ({ headers: IDENTITY_HEADERS, ok: true as const })),
        },
        resolveCfApiOrigin: () => CF_ORIGIN,
        trustedOrigins: { isTrusted: vi.fn(async () => ({ trusted: true })) },
      },
    });
    await adapter.connectServer("official-stdio", officialStdioConfig());

    await adapter.callTool({
      arguments: {},
      serverName: "official-stdio",
      toolName: "transcribe",
      trace: { sessionId: "session-1" as never, traceId: "trace-1" as never },
    });

    const meta = lastWireMeta();
    expect(meta?.[OFFICIAL_MCP_AUTH_META_KEY]).toMatchObject({ ok: true });
    expect(meta?.["com.cf/request-context"]).toEqual({
      session_id: "session-1",
      trace_id: "trace-1",
    });
  });

  it("OMCP-S03: forwards the port failure reason instead of failing closed", async () => {
    const adapter = createMcpAdapter({
      officialMcpAuth: {
        authHeadersPort: {
          resolveHeaders: vi.fn(async () => ({
            ok: false as const,
            reason: "official_auth_plan_required" as const,
          })),
        },
        resolveCfApiOrigin: () => CF_ORIGIN,
        trustedOrigins: { isTrusted: vi.fn(async () => ({ trusted: true })) },
      },
    });
    await adapter.connectServer("official-stdio", officialStdioConfig());

    const result = await adapter.callTool({
      arguments: {},
      serverName: "official-stdio",
      toolName: "transcribe",
    });

    expect(result).toBeDefined();
    expect(lastWireMeta()?.[OFFICIAL_MCP_AUTH_META_KEY]).toEqual({
      ok: false,
      reason: "official_auth_plan_required",
    });
  });

  it("OMCP-S04: refuses to resolve credentials when the origin is not trusted", async () => {
    const resolveHeaders = vi.fn(async () => ({ headers: IDENTITY_HEADERS, ok: true as const }));
    const adapter = createMcpAdapter({
      officialMcpAuth: {
        authHeadersPort: { resolveHeaders },
        resolveCfApiOrigin: () => "http://cf.example",
        trustedOrigins: {
          isTrusted: vi.fn(async () => ({ detail: "origin must be https", trusted: false })),
        },
      },
    });
    await adapter.connectServer("official-stdio", officialStdioConfig());

    await adapter.callTool({ arguments: {}, serverName: "official-stdio", toolName: "transcribe" });

    expect(lastWireMeta()?.[OFFICIAL_MCP_AUTH_META_KEY]).toEqual({
      ok: false,
      reason: "official_mcp_origin_untrusted",
    });
    expect(resolveHeaders).not.toHaveBeenCalled();
  });

  it("CR-02: maps a throwing origin resolver to official_auth_unavailable", async () => {
    const resolveHeaders = vi.fn(async () => ({ headers: IDENTITY_HEADERS, ok: true as const }));
    const isTrusted = vi.fn(async () => ({ trusted: true }));
    const adapter = createMcpAdapter({
      officialMcpAuth: {
        authHeadersPort: { resolveHeaders },
        resolveCfApiOrigin: () => {
          throw new Error("settings unavailable");
        },
        trustedOrigins: { isTrusted },
      },
    });
    await adapter.connectServer("official-stdio", officialStdioConfig());

    await adapter.callTool({ arguments: {}, serverName: "official-stdio", toolName: "transcribe" });

    expect(lastWireMeta()?.[OFFICIAL_MCP_AUTH_META_KEY]).toEqual({
      ok: false,
      reason: "official_auth_unavailable",
    });
    expect(isTrusted).not.toHaveBeenCalled();
    expect(resolveHeaders).not.toHaveBeenCalled();
  });

  it("CR-02: maps a throwing trust registry to official_auth_unavailable", async () => {
    const resolveHeaders = vi.fn(async () => ({ headers: IDENTITY_HEADERS, ok: true as const }));
    const adapter = createMcpAdapter({
      officialMcpAuth: {
        authHeadersPort: { resolveHeaders },
        resolveCfApiOrigin: () => CF_ORIGIN,
        trustedOrigins: {
          isTrusted: vi.fn(async () => {
            throw new Error("registry exploded");
          }),
        },
      },
    });
    await adapter.connectServer("official-stdio", officialStdioConfig());

    await adapter.callTool({ arguments: {}, serverName: "official-stdio", toolName: "transcribe" });

    expect(lastWireMeta()?.[OFFICIAL_MCP_AUTH_META_KEY]).toEqual({
      ok: false,
      reason: "official_auth_unavailable",
    });
    expect(resolveHeaders).not.toHaveBeenCalled();
  });

  it("OMCP-S05: reports official_auth_unavailable when the runtime has no auth port", async () => {
    const adapter = createMcpAdapter();
    await adapter.connectServer("official-stdio", officialStdioConfig());

    await adapter.callTool({ arguments: {}, serverName: "official-stdio", toolName: "transcribe" });

    expect(lastWireMeta()?.[OFFICIAL_MCP_AUTH_META_KEY]).toEqual({
      ok: false,
      reason: "official_auth_unavailable",
    });
  });

  it("SG-02: does not mark stdio official tools as display-trusted", async () => {
    clientListToolsMock.mockResolvedValueOnce({
      tools: [{ name: "transcribe", inputSchema: { properties: {}, type: "object" } }],
    });
    const adapter = createMcpAdapter({
      officialMcpAuth: {
        authHeadersPort: {
          resolveHeaders: vi.fn(async () => ({ headers: IDENTITY_HEADERS, ok: true as const })),
        },
        resolveCfApiOrigin: () => CF_ORIGIN,
        trustedOrigins: { isTrusted: vi.fn(async () => ({ trusted: true })) },
      },
    });
    await adapter.connectServer("official-stdio", officialStdioConfig());

    const tools = await adapter.listTools();
    expect(tools.map((tool) => tool.toolName)).toContain("transcribe");
    expect(tools[0]?.official).toBeUndefined();
  });

  it("OMCP-S06: never attaches the key for a server without official provenance", async () => {
    const resolveHeaders = vi.fn(async () => ({ headers: IDENTITY_HEADERS, ok: true as const }));
    const adapter = createMcpAdapter({
      officialMcpAuth: {
        authHeadersPort: { resolveHeaders },
        resolveCfApiOrigin: () => CF_ORIGIN,
        trustedOrigins: { isTrusted: vi.fn(async () => ({ trusted: true })) },
      },
    });
    await adapter.connectServer("forged", {
      auth: { provider: "jwt_token", type: "cf_official" },
      command: "python3",
      type: "stdio",
    });
    await adapter.connectServer("plain", { command: "node", type: "stdio" });

    await adapter.callTool({ arguments: {}, serverName: "forged", toolName: "x" });
    expect(lastWireMeta()?.[OFFICIAL_MCP_AUTH_META_KEY]).toBeUndefined();

    await adapter.callTool({ arguments: {}, serverName: "plain", toolName: "x" });
    expect(lastWireMeta()).toBeUndefined();
    expect(resolveHeaders).not.toHaveBeenCalled();
  });
});
