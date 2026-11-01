import { describe, expect, it } from "vitest";
import {
  appendCfStreamingToolInputDelta,
  buildCfStreamingToolInputPreview,
  markCfStreamingToolInputPreviewMaterialized,
  shouldMaterializeCfStreamingToolInputPreview,
} from "../src/streaming-tool-input-preview.js";

describe("streaming tool input preview", () => {
  it("extracts file path and growing content from partial JSON", () => {
    const first = appendCfStreamingToolInputDelta(
      undefined,
      '{"file_path":"src/app.ts","content":"line 1\\n',
    );
    const second = appendCfStreamingToolInputDelta(first, "line 2");
    const preview = buildCfStreamingToolInputPreview(second.rawInput);

    expect(first.deltaCount).toBe(1);
    expect(second.deltaCount).toBe(2);
    expect(preview.complete).toBe(false);
    expect(preview.input).toMatchObject({
      file_path: "src/app.ts",
      content: "line 1\nline 2",
    });
  });

  it("extracts a growing ExitPlanMode plan from partial JSON", () => {
    const preview = buildCfStreamingToolInputPreview(
      '{"plan":"# Implementation plan\\n\\n- Step 1\\n- 第Two',
    );

    expect(preview.complete).toBe(false);
    expect(preview.input).toEqual({
      plan: "# Implementation plan\n\n- Step 1\n- 第Two",
    });
  });

  it("prefers complete tool call input when available", () => {
    const preview = buildCfStreamingToolInputPreview('{"file_path":"old.ts"', {
      file_path: "src/final.ts",
      content: "done",
    });

    expect(preview.complete).toBe(true);
    expect(preview.input).toEqual({
      file_path: "src/final.ts",
      content: "done",
    });
  });

  it("extracts a user-facing title from partial tool input", () => {
    const preview = buildCfStreamingToolInputPreview(
      \'{\"code\":"await openPage();","title":\"Open target page\',
    );

    expect(preview.complete).toBe(false);
    expect(preview.input).toMatchObject({ title: "打开目标页面" });
  });

  it("extracts a CreateWorkflow name and growing script from partial JSON", () => {
    const preview = buildCfStreamingToolInputPreview(
      '{"name":"Research pipeline","script":"phase(\\"plan\\");\\nconst p = agent(\\"pl',
    );

    expect(preview.complete).toBe(false);
    expect(preview.input).toMatchObject({
      name: "Research pipeline",
      script: 'phase("plan");\nconst p = agent("pl',
    });
  });

  it("budgets active preview materialization and keeps background as tombstone", () => {
    const first = appendCfStreamingToolInputDelta(undefined, '{"content":"a');
    expect(shouldMaterializeCfStreamingToolInputPreview(first)).toBe(true);
    markCfStreamingToolInputPreviewMaterialized(first, 1_000);

    const second = appendCfStreamingToolInputDelta(first, "b");
    expect(
      shouldMaterializeCfStreamingToolInputPreview(second, {
        now: 1_100,
      }),
    ).toBe(false);
    expect(
      shouldMaterializeCfStreamingToolInputPreview(second, {
        now: 2_000,
      }),
    ).toBe(true);
    expect(
      shouldMaterializeCfStreamingToolInputPreview(second, {
        mode: "background-summary",
        now: 2_000,
      }),
    ).toBe(false);
  });

  it.each(["Write", "Edit"])(
    "%s previews the first delta eagerly and subsequent deltas once per second",
    (toolName) => {
      const first = appendCfStreamingToolInputDelta(undefined, '{"content":"a');
      expect(shouldMaterializeCfStreamingToolInputPreview(first, { now: 1_000, toolName })).toBe(
        true,
      );
      markCfStreamingToolInputPreviewMaterialized(first, 1_000);

      const second = appendCfStreamingToolInputDelta(first, "b".repeat(9 * 1024));
      expect(
        shouldMaterializeCfStreamingToolInputPreview(second, { now: 1_999, toolName }),
      ).toBe(false);
      expect(
        shouldMaterializeCfStreamingToolInputPreview(second, { now: 2_000, toolName }),
      ).toBe(true);
    },
  );

  it("keeps the raw-growth shortcut for non-file tools", () => {
    const first = appendCfStreamingToolInputDelta(undefined, '{"command":"p');
    markCfStreamingToolInputPreviewMaterialized(first, 1_000);
    const second = appendCfStreamingToolInputDelta(first, "x".repeat(8 * 1024));

    expect(
      shouldMaterializeCfStreamingToolInputPreview(second, {
        now: 1_001,
        toolName: "Bash",
      }),
    ).toBe(true);
  });

  it("does not time-flush large active inputs before raw growth budget", () => {
    const first = appendCfStreamingToolInputDelta(undefined, "x".repeat(9 * 1024));
    expect(shouldMaterializeCfStreamingToolInputPreview(first)).toBe(true);
    markCfStreamingToolInputPreviewMaterialized(first, 1_000);

    const slowChunk = appendCfStreamingToolInputDelta(first, "y");
    expect(
      shouldMaterializeCfStreamingToolInputPreview(slowChunk, {
        now: 10_000,
      }),
    ).toBe(false);

    const grownChunk = appendCfStreamingToolInputDelta(first, "y".repeat(8 * 1024));
    expect(
      shouldMaterializeCfStreamingToolInputPreview(grownChunk, {
        now: 10_000,
      }),
    ).toBe(true);
  });
});
