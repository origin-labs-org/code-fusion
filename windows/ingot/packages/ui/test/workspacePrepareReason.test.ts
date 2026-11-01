import { describe, expect, it } from "vitest";
import {
  resolveDraftWorkspacePrepareReason,
  shouldShowDraftWorkspacePrepareLoading,
} from "../src/lib/workspacePrepareReason.js";

describe("resolveDraftWorkspacePrepareReason", () => {
  it("首次进入Draft态时按 mount Processing", () => {
    expect(
      resolveDraftWorkspacePrepareReason({
        previousDraftProvider: null,
        previousTaskProvider: null,
        selectedProvider: "claude",
        returningFromTask: false,
      }),
    ).toBe("mount");
  });

  it("Draft态inner切换 provider 时Back select-provider", () => {
    expect(
      resolveDraftWorkspacePrepareReason({
        previousDraftProvider: "claude",
        previousTaskProvider: null,
        selectedProvider: "codex",
        returningFromTask: false,
      }),
    ).toBe("select-provider");
  });

  it("从 task 回到同 provider Draft时不应误判为切换 provider", () => {
    expect(
      resolveDraftWorkspacePrepareReason({
        previousDraftProvider: "claude",
        previousTaskProvider: "claude",
        selectedProvider: "claude",
        returningFromTask: true,
      }),
    ).toBe("mount");
  });

  it("从 task 回到不同 provider Draft时按 select-provider Processing，避免沿用Old provider 的ModelShow", () => {
    expect(
      resolveDraftWorkspacePrepareReason({
        previousDraftProvider: "claude",
        previousTaskProvider: "claude",
        selectedProvider: "opencode",
        returningFromTask: true,
      }),
    ).toBe("select-provider");
  });

  it("task inner先切New provider 后再进Draft时，按 task 原 provider Triage切换", () => {
    expect(
      resolveDraftWorkspacePrepareReason({
        previousDraftProvider: "codex",
        previousTaskProvider: "claude",
        selectedProvider: "codex",
        returningFromTask: true,
      }),
    ).toBe("select-provider");
  });
});

describe("shouldShowDraftWorkspacePrepareLoading", () => {
  it("首屏 mount 且尚未拿到Configuration快照时Show loading", () => {
    expect(
      shouldShowDraftWorkspacePrepareLoading({
        taskId: null,
        reason: "mount",
        hasHydratedConfigOptions: false,
      }),
    ).toBe(true);
  });

  it("首屏 mount 但已有Configuration快照时不重复Show loading", () => {
    expect(
      shouldShowDraftWorkspacePrepareLoading({
        taskId: null,
        reason: "mount",
        hasHydratedConfigOptions: true,
      }),
    ).toBe(false);
  });

  it("Draft态inner切换 provider 时ContinueShow loading", () => {
    expect(
      shouldShowDraftWorkspacePrepareLoading({
        taskId: null,
        reason: "select-provider",
        hasHydratedConfigOptions: true,
      }),
    ).toBe(true);
  });

  it("已有 task 时不走Draft loading 逻辑", () => {
    expect(
      shouldShowDraftWorkspacePrepareLoading({
        taskId: "task-1",
        reason: "mount",
        hasHydratedConfigOptions: false,
      }),
    ).toBe(false);
  });
});
