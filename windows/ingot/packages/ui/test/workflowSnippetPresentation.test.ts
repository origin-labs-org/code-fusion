import { describe, expect, it } from "vitest";
import {
  snippetResponse,
  snippetValue,
} from "@/ToolCallBlocks/renderers/workflow-snippet-presentation.js";
const base = {
  kind: "eval_workflow_snippet" as const,
  ok: true,
  diagnostics: [],
  logs: [],
  durationMs: 427,
  response: "",
};
describe("snippet response presentation", () => {
  it("只RetainBackValue，剥离已知耗时and重复Logs", () => {
    expect(
      snippetResponse({
        ...base,
        logs: ["done"],
        response: "The snippet completed in 427ms.\nReturn value:\n[1,2]\n\nLogs:\n- done",
      }),
    ).toBe("[1,2]");
    expect(snippetValue("[1,2]").code).toBe("[\n  1,\n  2\n]");
  });
  it("没有BackValue不渲染占位；Retain JSON null", () => {
    expect(
      snippetResponse({
        ...base,
        response: "The snippet completed in 427ms.\nIt returned no value.",
      }),
    ).toBeUndefined();
    expect(
      snippetResponse({
        ...base,
        response: "The snippet completed in 427ms.\nReturn value:\nnull",
      }),
    ).toBe("null");
  });
  it("Unknown格式and截断inner容原样Retain，不误删BackTextMedium的 Logs", () => {
    const response = "custom result\n\nLogs:\n- actual return text";
    expect(snippetResponse({ ...base, response })).toBe(response);
    expect(
      snippetResponse({ ...base, response: "The snippet completed in 4…", truncated: true }),
    ).toBe("The snippet completed in 4…");
  });
  it("已知Diagnostics包装只ShowOne次，RunErrorRetain", () => {
    expect(
      snippetResponse({
        ...base,
        ok: false,
        diagnostics: [{ line: 1, column: 2, code: 3, message: "bad" }],
        response:
          "The snippet has errors:\nL1:C2 bad\n\nNOTE: The snippet was NOT executed — fix the errors above and call the tool again.",
      }),
    ).toBeUndefined();
    expect(
      snippetResponse({ ...base, ok: false, response: "The snippet failed (TIMEOUT): timeout" }),
    ).toContain("TIMEOUT");
  });
});
