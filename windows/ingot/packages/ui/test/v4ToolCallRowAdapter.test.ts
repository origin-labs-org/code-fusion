import { describe, expect, it } from "vitest";
import type { ToolCallRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import { buildToolDisplayModel } from "@/lib/toolDisplay.js";
import { toolCallRowToLegacyNode } from "@/v4/toolCallRowAdapter.js";

function makeRow(overrides: Partial<ToolCallRow> = {}): ToolCallRow {
  return {
    rowId: 7,
    turnId: "turn-1",
    createdAt: 1000,
    createdAtSeq: 3,
    kind: "toolCall",
    toolCallId: "call-abc",
    toolName: "Bash",
    status: "running",
    inputText: '{"command":"ls -la"}',
    input: { command: "ls -la" },
    ...overrides,
  };
}

describe("toolCallRowToLegacyNode", () => {
  it("Character段映射：toolId/toolName/kind/input/startedAt，无子树", () => {
    const node = toolCallRowToLegacyNode(makeRow({ startedAt: 1234 }));
    expect(node.toolCall.toolId).toBe("call-abc");
    expect(node.toolCall.toolName).toBe("Bash");
    expect(node.toolCall.kind).toBe("Bash");
    expect(node.toolCall.input).toEqual({ command: "ls -la" });
    expect(node.toolCall.startedAt).toBe(1234);
    expect(node.childToolCalls).toEqual([]);
  });

  it("把投影时固化的 CUA App 身份桥接ToSummary renderer", () => {
    const cuaApp = { pid: 42, name: "Zed", bundleId: "dev.zed.Zed" };
    const node = toolCallRowToLegacyNode(makeRow({ cuaApp }));
    expect(node.toolCall.raw).toMatchObject({ cuaApp });
  });

  it("status 全量映射到 mapToolStatus 词表", () => {
    const cases: Array<[ToolCallRow["status"], string]> = [
      ["inputStreaming", "pending"],
      ["pendingApproval", "pending"],
      ["running", "in_progress"],
      ["success", "completed"],
      ["error", "failed"],
      ["cancelled", "stopped"],
    ];
    for (const [v4Status, legacy] of cases) {
      expect(toolCallRowToLegacyNode(makeRow({ status: v4Status })).toolCall.status).toBe(legacy);
    }
  });

  it("output/error 映射：Final stateText与ErrorLetter息透传", () => {
    const node = toolCallRowToLegacyNode(
      makeRow({
        status: "error",
        output: { text: "partial output" },
        error: { code: "toolFailed", message: "command not found" },
      }),
    );
    expect(node.toolCall.output).toBe("partial output");
    expect(node.toolCall.error).toBe("command not found");
  });

  it.each([
    {
      kind: "task_output",
      retrievalStatus: "not_ready",
      taskStatus: "running",
      output: "partial output",
    },
    {
      kind: "respond_to_coordinator",
      status: "success",
    },
  ] as const)("Retain $kind display To专属 renderer", (display) => {
    const node = toolCallRowToLegacyNode(
      makeRow({
        status: "success",
        display,
      }),
    );

    expect(node.toolCall.raw).toMatchObject({ display });
  });

  it("可Letter MCP discovery 展示Metadata透传到 legacy raw，不反拆合成Tools名", () => {
    const node = toolCallRowToLegacyNode(
      makeRow({
        toolName: "custom-provider-visible-name",
        status: "success",
        display: {
          kind: "mcp_tool",
          serverName: "company-github-prod",
          toolName: "issue_query_v2",
          description: "Query issues visible to the current user.",
        },
      }),
    );

    expect(node.toolCall.raw).toMatchObject({
      display: {
        kind: "mcp_tool",
        serverName: "company-github-prod",
        toolName: "issue_query_v2",
      },
    });
  });

  it("把 output.display Medium的 CUA Screenshot桥接到 legacy raw", () => {
    const node = toolCallRowToLegacyNode(
      makeRow({
        toolName: "mcp__computer-use__computer-use",
        status: "success",
        output: {
          text: "[Attached image/jpeg: MCP image]",
          display: {
            kind: "cua",
            schemaVersion: 1,
            toolName: "computer-use",
            status: "success",
            input: '{"action":"screenshot"}',
            media: [{ mimeType: "image/jpeg", data: "AAAA" }],
          },
        },
      }),
    );

    expect(node.toolCall.raw).toMatchObject({
      display: {
        kind: "cua",
        media: [{ mimeType: "image/jpeg", data: "AAAA" }],
      },
    });
    expect(node.toolCall.raw?.display).not.toHaveProperty("input");
  });

  it("ContinueCompatible顶层 Node REPL Image display", () => {
    const node = toolCallRowToLegacyNode(
      makeRow({
        display: {
          kind: "node_repl_images",
          images: [{ base64: "AAAA", mimeType: "image/png" }],
        },
      }),
    );

    expect(node.toolCall.raw).toMatchObject({
      display: {
        kind: "node_repl_images",
        images: [{ base64: "AAAA", mimeType: "image/png" }],
      },
    });
  });

  it("background Agent 的Final state output 同时桥接为可展开EventsBody", () => {
    const node = toolCallRowToLegacyNode(
      makeRow({
        toolName: "Agent",
        status: "error",
        output: { text: "Agent task failed. Requests are too frequent." },
        error: {
          code: "fault.runtime.backgroundTaskFailed",
          message: "Requests are too frequent.",
        },
      }),
    );

    expect(node.toolCall.content).toBe("Agent task failed. Requests are too frequent.");
    expect(node.toolCall.status).toBe("failed");
    expect(node.toolCall.error).toBe("Requests are too frequent.");
  });

  it("status=error 但 error.message 缺席时，从 tagged output 还原ErrorBody", () => {
    const node = toolCallRowToLegacyNode(
      makeRow({
        status: "error",
        output: {
          text: "<tool_use_error>Permission denied: /workspace/secret.txt</tool_use_error>",
        },
      }),
    );

    expect(node.toolCall.status).toBe("failed");
    expect(node.toolCall.error).toBe("Permission denied: /workspace/secret.txt");
    expect(node.toolCall.raw).toMatchObject({
      rawOutput: "<tool_use_error>Permission denied: /workspace/secret.txt</tool_use_error>",
      status: "failed",
      v4Status: "error",
    });
  });

  it("status=error 但没有Structures化 error 时，用普通 output Text兜出Error", () => {
    const node = toolCallRowToLegacyNode(
      makeRow({
        status: "error",
        output: { text: "Permission denied while reading /workspace/secret.txt" },
      }),
    );

    expect(node.toolCall.error).toBe("Permission denied while reading /workspace/secret.txt");
  });

  it("status=error 且 message 为空时，用 error code 作为最后可见Error", () => {
    const node = toolCallRowToLegacyNode(
      makeRow({
        status: "error",
        error: { code: "tool_use_failed", message: "" },
      }),
    );

    expect(node.toolCall.error).toBe("tool_use_failed");
  });

  it("非FailedStatus不会把 output 误投成Error", () => {
    const success = toolCallRowToLegacyNode(makeRow({ status: "success", output: { text: "ok" } }));
    const cancelled = toolCallRowToLegacyNode(
      makeRow({ status: "cancelled", output: { text: "stopped by user" } }),
    );

    expect(success.toolCall.error).toBeUndefined();
    expect(cancelled.toolCall.error).toBeUndefined();
  });

  it("input 缺席时从 inputText 还原；半截 JSON 也生成Streaming预览 input", () => {
    const parsed = toolCallRowToLegacyNode(
      makeRow({ input: undefined, inputText: '{"file_path":"/a.ts"}' }),
    );
    expect(parsed.toolCall.input).toEqual({ file_path: "/a.ts" });

    const streaming = toolCallRowToLegacyNode(
      makeRow({
        toolName: "Write",
        status: "inputStreaming",
        input: undefined,
        inputText: '{"file_path":"src/app.ts","content":"line 1\\nline 2',
      }),
    );
    expect(streaming.toolCall.input).toMatchObject({
      file_path: "src/app.ts",
      content: "line 1\nline 2",
    });
    expect(streaming.toolCall.raw).toMatchObject({
      inputPreviewComplete: false,
      streamingRawInputLength: '{"file_path":"src/app.ts","content":"line 1\\nline 2'.length,
    });

    const displayModel = buildToolDisplayModel(streaming.toolCall, "/workspace");
    expect(displayModel.inlinePreview.type).toBe("text");
    if (displayModel.inlinePreview.type === "text") {
      expect(displayModel.inlinePreview.source.path).toBe("/workspace/src/app.ts");
      expect(displayModel.inlinePreview.source.content).toBe("line 1\nline 2");
    }

    const empty = toolCallRowToLegacyNode(makeRow({ input: undefined, inputText: "" }));
    expect(empty.toolCall.input).toBeUndefined();
  });
});
