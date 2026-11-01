// @vitest-environment node

import { describe, expect, it } from "vitest";

import { registerMcpTools } from "../src/mcp/index.js";
import { createToolRegistry } from "../src/tool/registry.js";
import type { McpPort } from "@origin-ai/cf-shared";

describe("formatMcpToolResult structuredContent projection", () => {
  const createMockMcpPort = (): McpPort =>
    ({
      connectConfiguredServers: async () => ({ statuses: {}, tools: [] }),
      connectServer: async () => ({
        status: "connected",
        transport: "stdio",
        toolCount: 1,
        updatedAt: "now",
      }),
      disconnectServer: async () => undefined,
      status: async () => ({}),
      listTools: async () => [],
      callTool: async () => ({ content: [] }),
      close: async () => {},
    }) as McpPort;

  function structuredToolEntry() {
    const registry = createToolRegistry();
    registerMcpTools(registry, createMockMcpPort(), [
      {
        serverName: "modern",
        toolName: "structured",
        inputSchema: { type: "object" },
      },
    ]);
    return registry.get("mcp__modern__structured");
  }

  it("undefined 值不投影（CUA 成功结果空尾巴修复）", () => {
    const entry = structuredToolEntry();
    expect(
      entry?.formatModelContent?.({
        content: [{ type: "text", text: '{"pid":18067}' }],
        structuredContent: undefined,
      }),
    ).toBe('{"pid":18067}');
  });

  it("null / 空对象 / 空数组值同样不投影", () => {
    const entry = structuredToolEntry();
    for (const empty of [null, {}, []]) {
      expect(
        entry?.formatModelContent?.({
          content: [{ type: "text", text: "ok" }],
          structuredContent: empty,
        }),
      ).toBe("ok");
    }
  });

  it("有值的 structuredContent 仍完整投影（错误 delivery details 通道）", () => {
    const entry = structuredToolEntry();
    expect(
      entry?.formatModelContent?.({
        content: [{ type: "text", text: "blocked" }],
        isError: true,
        structuredContent: { action_sent: true, request_delivery_state: "possibly_sent" },
      }),
    ).toContain(
      'Structured content:\n{\n  "action_sent": true,\n  "request_delivery_state": "possibly_sent"\n}',
    );
  });
});
