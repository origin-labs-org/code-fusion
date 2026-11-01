import { describe, expect, it, vi } from "vitest";
import { logger } from "@/logger.js";
import {
  captureComposerRecentSubmission,
  readComposerRecent,
  resolveDraftInitialModelSelection,
  prepareComposerRecentReceipt,
  acceptComposerRecentReceipt,
} from "@/lib/composerRecent.js";

vi.mock("@/logger.js", () => ({ logger: { warn: vi.fn() } }));

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    values,
  };
}

const selection = { providerId: "provider", modelId: "model", options: { reasoningLevel: "high" } };
const key = "cf-model-selection-recent-v1:/repo";

describe("composerRecent", () => {
  it("PD07 Persisted acceptance order prevents old config writeback during recovery queries", () => {
    const target = storage();
    const scope = { clientNamespace: "desktop", hostId: "local", projectId: "p" };
    const old = prepareComposerRecentReceipt(scope, { modelSelection: selection, mode: "build" });
    const latest = prepareComposerRecentReceipt(scope, {
      modelSelection: { ...selection, modelId: "next" },
      mode: "yolo",
    });
    expect(acceptComposerRecentReceipt(latest, target)).toBe(true);
    expect(acceptComposerRecentReceipt(JSON.parse(JSON.stringify(old)), target)).toBe(true);
    expect(readComposerRecent("/any", undefined, target, scope)).toMatchObject({
      mode: "yolo",
      modelSelection: { modelId: "next" },
    });
  });
  it("PD04 Recents follow the project rather than the directory; task config is reused across new directories", () => {
    const target = storage();
    const p = { clientNamespace: "desktop", hostId: "local", projectId: "p" };
    const task = { ...p, projectId: null };
    const accept = captureComposerRecentSubmission(
      "/repo",
      { modelSelection: selection, mode: "yolo" },
      undefined,
      target,
      p,
    );
    expect(readComposerRecent("/repo", undefined, target, p)).toBeNull();
    accept();
    expect(readComposerRecent("/new-root", undefined, target, p)).toEqual({
      modelSelection: selection,
      mode: "yolo",
    });
    expect(readComposerRecent("/repo", undefined, target, { ...p, projectId: "q" })).toBeNull();
    expect(readComposerRecent("/repo", undefined, target, task)).toBeNull();
    captureComposerRecentSubmission(
      "/task-a",
      { modelSelection: selection, mode: "build" },
      undefined,
      target,
      task,
    )();
    expect(readComposerRecent("/task-b", undefined, target, task)?.mode).toBe("build");
    expect(
      readComposerRecent("/task-b", undefined, target, { ...task, clientNamespace: "mobile" }),
    ).toBeNull();
  });

  it("Read pure ModelSelection using legacy keys without fabricating modes for legacy records", () => {
    const target = storage();
    target.values.set(key, JSON.stringify(selection));
    expect(readComposerRecent("/repo", undefined, target)).toEqual({ modelSelection: selection });
    expect(target.setItem).not.toHaveBeenCalled();
  });

  it.each([
    [JSON.stringify({ modelSelection: selection, mode: "invalid" }), { modelSelection: selection }],
    [JSON.stringify({ modelSelection: { bad: true }, mode: "yolo" }), { mode: "yolo" }],
    [JSON.stringify({ mode: "plan" }), { mode: "plan" }],
    [
      JSON.stringify({
        providerId: "provider",
        modelId: "model",
        options: { maxOutputTokens: 4096 },
      }),
      null,
    ],
    ["{}", null],
    ["null", null],
    ["broken", null],
  ])("Validate model and mode independently: %s", (raw, expected) => {
    const target = storage();
    target.values.set(key, raw);
    expect(readComposerRecent("/repo", undefined, target)).toEqual(expected);
  });

  it("Write frozen model and mode in one go upon acceptance; unaccepted candidates do not alter Recents", () => {
    const target = storage();
    const submission = { modelSelection: { ...selection, options: {} }, mode: "yolo" as const };
    const accept = captureComposerRecentSubmission("/repo", submission, undefined, target);
    expect(readComposerRecent("/repo", undefined, target)).toBeNull();
    submission.modelSelection.modelId = "edited-after-submit";
    accept();
    accept();
    expect(target.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(target.values.get(key)!)).toEqual({
      modelSelection: { providerId: "provider", modelId: "model" },
      mode: "yolo",
    });
    captureComposerRecentSubmission(
      "/repo",
      { modelSelection: selection, mode: "build" },
      undefined,
      target,
    );
    expect(readComposerRecent("/repo", undefined, target)?.mode).toBe("yolo");
  });

  it("Late legacy accepted submissions do not overwrite newer accepted ones; newer failures do not block older successes", () => {
    const target = storage();
    const older = captureComposerRecentSubmission(
      "/repo",
      { modelSelection: selection, mode: "yolo" },
      undefined,
      target,
    );
    const newer = captureComposerRecentSubmission(
      "/repo",
      { modelSelection: selection, mode: "plan" },
      undefined,
      target,
    );
    newer();
    older();
    expect(readComposerRecent("/repo", undefined, target)?.mode).toBe("plan");
    const accepted = captureComposerRecentSubmission(
      "/repo",
      { modelSelection: selection, mode: "edit" },
      undefined,
      target,
    );
    captureComposerRecentSubmission(
      "/repo",
      { modelSelection: selection, mode: "build" },
      undefined,
      target,
    );
    accepted();
    expect(readComposerRecent("/repo", undefined, target)?.mode).toBe("edit");
  });

  it("Submissions targeting accelerator card Providers are not written to Recents, preserving the last valid record (spec §5.1)", () => {
    const target = storage();
    captureComposerRecentSubmission(
      "/repo",
      { modelSelection: selection, mode: "build" },
      undefined,
      target,
    )();
    const accelerated = captureComposerRecentSubmission(
      "/repo",
      {
        modelSelection: { providerId: "account:zai-highspeed-card", modelId: "GLM-5.3" },
        mode: "build",
      },
      undefined,
      target,
    );
    accelerated();
    expect(JSON.parse(target.values.get(key)!)).toEqual({
      modelSelection: selection,
      mode: "build",
    });
  });

  it("Read self-healing: existing model leaves targeting accelerator card Providers are dropped, preserving mode (spec §5.1)", () => {
    const target = storage();
    target.values.set(
      key,
      JSON.stringify({
        modelSelection: { providerId: "account:bigmodel-highspeed-card", modelId: "GLM-5.3" },
        mode: "yolo",
      }),
    );
    expect(readComposerRecent("/repo", undefined, target)).toEqual({ mode: "yolo" });
    target.values.set(
      key,
      JSON.stringify({ providerId: "account:zai-highspeed-card", modelId: "GLM-5.3" }),
    );
    expect(readComposerRecent("/repo", undefined, target)).toBeNull();
  });

  it("Local paths and different remotes with the same path are saved separately; empty identity uses local path", () => {
    const target = storage();
    const local = captureComposerRecentSubmission(
      "/repo",
      { modelSelection: selection, mode: "build" },
      " ",
      target,
    );
    const remoteA = captureComposerRecentSubmission(
      "/repo",
      { modelSelection: selection, mode: "yolo" },
      " ssh://a/repo ",
      target,
    );
    const remoteB = captureComposerRecentSubmission(
      "/repo",
      { modelSelection: selection, mode: "plan" },
      "ssh://b/repo",
      target,
    );
    remoteB();
    remoteA();
    local();
    expect(readComposerRecent("/repo", undefined, target)?.mode).toBe("build");
    expect(readComposerRecent("/repo", "ssh://a/repo", target)?.mode).toBe("yolo");
    expect(readComposerRecent("/repo", "ssh://b/repo", target)?.mode).toBe("plan");
    expect(readComposerRecent("/elsewhere", undefined, target)).toBeNull();
  });

  it("存储不可用或写入失败不抛给已接纳发送", () => {
    const failure = new Error("quota exceeded");
    const target = {
      getItem: () => {
        throw failure;
      },
      setItem: () => {
        throw failure;
      },
    };
    expect(readComposerRecent("/repo", undefined, target)).toBeNull();
    const accept = captureComposerRecentSubmission(
      "/repo",
      { modelSelection: selection, mode: "yolo" },
      undefined,
      target,
    );
    expect(accept).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("ComposerRecent"),
      expect.objectContaining({ error: failure }),
    );
    expect(
      captureComposerRecentSubmission(
        "/repo",
        { modelSelection: selection, mode: "yolo" },
        undefined,
        null,
      ),
    ).not.toThrow();
  });

  it("Invalid submission configs do not block Recents capture on the sender side", () => {
    vi.clearAllMocks();
    const target = storage();
    const invalidMode = {
      modelSelection: selection,
      mode: "invalid",
    } as never;
    const invalidModel = {
      modelSelection: null,
      mode: "yolo",
    } as never;

    expect(() =>
      captureComposerRecentSubmission("/repo", invalidMode, undefined, target),
    ).not.toThrow();
    expect(() =>
      captureComposerRecentSubmission("/repo", invalidModel, undefined, target),
    ).not.toThrow();
    expect(target.setItem).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("Clear invalid Model; keep model and clear tier for invalid Reasoning", () => {
    const view = {
      revision: 1,
      preferredSelection: {
        providerId: "provider",
        modelId: "model-b",
        options: { reasoningLevel: "high" },
      },
      providers: [
        {
          providerId: "provider",
          config: {},
          models: [
            {
              modelId: "model-a",
              config: { optionSpecs: { reasoningLevel: { values: ["low", "high"] } } },
            },
            {
              modelId: "model-b",
              config: { optionSpecs: { reasoningLevel: { values: ["low", "high"] } } },
            },
          ],
        },
      ],
    } as const;
    expect(
      resolveDraftInitialModelSelection(view, {
        providerId: "removed",
        modelId: "removed",
      }),
    ).toEqual({ selection: null, invalidated: true });
    expect(
      resolveDraftInitialModelSelection(view, {
        providerId: "provider",
        modelId: "model-a",
        options: { reasoningLevel: "removed" },
      }),
    ).toEqual({ selection: { providerId: "provider", modelId: "model-a" }, invalidated: true });
    expect(
      resolveDraftInitialModelSelection({ ...view, preferredSelection: undefined }, null),
    ).toEqual({ selection: null, invalidated: false });
  });
});
