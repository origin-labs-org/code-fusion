import { describe, expect, it } from "vitest";
import { extractPlanToolCallContent, getPlanDirectoryTitle } from "../src/lib/planToolCall.js";

describe("planToolCall", () => {
  it("prefers the streaming input plan and resolves a relative plan file", () => {
    expect(
      extractPlanToolCallContent(
        {
          input: {
            plan: "# Plan\n\n- Step 1",
            planFilePath: ".cf/plans/demo.md",
          },
          output: "fallback",
        },
        "/workspace",
      ),
    ).toEqual({
      markdown: "# Plan\n\n- Step 1",
      planFilePath: "/workspace/.cf/plans/demo.md",
    });
  });

  it("extracts a directory title from H1 before falling back to the first text line", () => {
    expect(getPlanDirectoryTitle("\n## Summary\n\n# Final Implementation Plan\n")).toBe("Final Implementation Plan");
    expect(getPlanDirectoryTitle("\n> Only a one-line summary\n\n- 细节")).toBe("Only a one-line summary");
    expect(getPlanDirectoryTitle(" \n\t")).toBeUndefined();
  });

  it("reads a completed plan from serialized tool input text", () => {
    expect(
      extractPlanToolCallContent(
        {
          inputText: JSON.stringify({ plan: "# 冷恢复计划" }),
          output: { content: "tool finished" },
        },
        "/workspace",
      ),
    ).toEqual({ markdown: "# 冷恢复计划" });
  });
});
