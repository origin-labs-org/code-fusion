// @vitest-environment jsdom

//
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CfSavedWorkflowRun } from "@origin-ai/cf-shared";
import {
  useSavedWorkflowRunOpeners,
  type SavedWorkflowRunOpenTarget,
} from "@/settings/saved-workflows/useSavedWorkflowRunOpeners.js";

const onOpenWorkflowRun = vi.fn();
const onOpenWorkflowArtifact = vi.fn();

const TARGET: SavedWorkflowRunOpenTarget = {
  workspacePath: "/repo",
  workspaceIdentity: "ssh://host/repo",
};

function run(overrides: Partial<CfSavedWorkflowRun> = {}): CfSavedWorkflowRun {
  return {
    runId: "r-1",
    name: "release-check",
    status: "completed",
    createdAt: 1,
    updatedAt: 2,
    spentTokens: 0,
    parentSessionId: "s1",
    toolCallId: "t1",
    artifacts: [
      { id: "book", kind: "file", title: "审计报告", version: 2, contentType: "text/html" },
    ],
    ...overrides,
  };
}

function openers(target: SavedWorkflowRunOpenTarget | null = TARGET) {
  return renderHook(() =>
    useSavedWorkflowRunOpeners({
      resolveTarget: () => target,
      onOpenWorkflowRun,
      onOpenWorkflowArtifact,
    }),
  ).result.current;
}

beforeEach(() => {
  onOpenWorkflowRun.mockClear();
  onOpenWorkflowArtifact.mockClear();
});

describe("useSavedWorkflowRunOpeners", () => {
  it("「View Instance」带上 toolCallId 与TargetProject", () => {
    openers().handleOpenRun(run(), "release-check");
    expect(onOpenWorkflowRun).toHaveBeenCalledWith({
      sessionId: "s1",
      runId: "r-1",
      toolCallId: "t1",
      workflowName: "release-check",
      workspacePath: "/repo",
      workspaceIdentity: "ssh://host/repo",
    });
  });

  it("产物 chip 的实参**不含 toolCallId**，但带上展示名与 contentType（End点据它分流 html 产物）", () => {
    openers().handleOpenArtifact(run(), "book");
    expect(onOpenWorkflowArtifact).toHaveBeenCalledWith({
      sessionId: "s1",
      runId: "r-1",
      artifactId: "book",
      title: "审计报告",
      contentType: "text/html",
      workspacePath: "/repo",
      workspaceIdentity: "ssh://host/repo",
    });
  });

  it("老行的 chip 载荷不带 contentType 时不编One个出来（少One个键Yes退化不YesError）", () => {
    openers().handleOpenArtifact(
      run({ artifacts: [{ id: "book", kind: "file", title: "审计报告", version: 2 }] }),
      "book",
    );
    expect(onOpenWorkflowArtifact).toHaveBeenCalledWith({
      sessionId: "s1",
      runId: "r-1",
      artifactId: "book",
      title: "审计报告",
      workspacePath: "/repo",
      workspaceIdentity: "ssh://host/repo",
    });
  });

  it("老行缺 toolCallId：「View Instance」Close，产物仍然打得开", () => {
    const legacy = run({ toolCallId: undefined });
    const hook = openers();
    hook.handleOpenRun(legacy, "release-check");
    expect(onOpenWorkflowRun).not.toHaveBeenCalled();

    hook.handleOpenArtifact(legacy, "book");
    expect(onOpenWorkflowArtifact).toHaveBeenCalledTimes(1);
  });

  it("缺 parentSessionId：两个入口都关（产物 tab 必须开在发From它的Session里）", () => {
    const orphan = run({ parentSessionId: undefined });
    const hook = openers();
    hook.handleOpenRun(orphan, "release-check");
    hook.handleOpenArtifact(orphan, "book");
    expect(onOpenWorkflowRun).not.toHaveBeenCalled();
    expect(onOpenWorkflowArtifact).not.toHaveBeenCalled();
  });

  it("TargetProject没打开（Global tier按 cwd 反查不到）：两个入口都关", () => {
    const hook = openers(null);
    hook.handleOpenRun(run(), "release-check");
    hook.handleOpenArtifact(run(), "book");
    expect(onOpenWorkflowRun).not.toHaveBeenCalled();
    expect(onOpenWorkflowArtifact).not.toHaveBeenCalled();
  });

  it("产物不在该行的清单里时不编造Title，只送 id", () => {
    openers().handleOpenArtifact(run({ artifacts: undefined }), "book");
    expect(onOpenWorkflowArtifact).toHaveBeenCalledWith({
      sessionId: "s1",
      runId: "r-1",
      artifactId: "book",
      workspacePath: "/repo",
      workspaceIdentity: "ssh://host/repo",
    });
  });

  it("LocalProject没有 workspaceIdentity 时不硬塞One个Empty value（身份语义按 workspaceKey 回退）", () => {
    openers({ workspacePath: "/repo" }).handleOpenArtifact(run(), "book");
    expect(onOpenWorkflowArtifact).toHaveBeenCalledWith({
      sessionId: "s1",
      runId: "r-1",
      artifactId: "book",
      title: "审计报告",
      contentType: "text/html",
      workspacePath: "/repo",
    });
  });
});
