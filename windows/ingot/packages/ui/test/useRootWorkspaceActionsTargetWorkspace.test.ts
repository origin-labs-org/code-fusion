import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { resolveNewTaskTargetFromRequest } from "@/root/useRootWorkspaceActions.js";
import type { WorkbenchNewTaskTarget } from "@/conversation-workspace-target/workbenchTarget.js";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8").replaceAll("\r\n", "\n");
}

describe("resolveNewTaskTargetFromRequest", () => {
  it("request 带 targetWorkspace 时采用它，且不询Question workbench 焦点解析", () => {
    const fallback = vi.fn<[], WorkbenchNewTaskTarget | null>(() => ({
      workspacePath: "/active",
    }));

    const target = resolveNewTaskTargetFromRequest(
      {
        initialPrompt: "运行工作流",
        targetWorkspace: {
          workspacePath: "/owner",
          workspaceIdentity: "remote:ssh:dev:/owner",
        },
      },
      fallback,
    );

    expect(target).toEqual({
      workspacePath: "/owner",
      workspaceIdentity: "remote:ssh:dev:/owner",
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("targetWorkspace 缺省 identity 时归One化为 null", () => {
    const fallback = vi.fn<[], WorkbenchNewTaskTarget | null>(() => null);

    const target = resolveNewTaskTargetFromRequest(
      { targetWorkspace: { workspacePath: "/owner" } },
      fallback,
    );

    expect(target).toEqual({ workspacePath: "/owner", workspaceIdentity: null });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("无 targetWorkspace 时回退到 workbench 解析，并把缺省 identity 归One化为 null", () => {
    const fallback = vi.fn<[], WorkbenchNewTaskTarget | null>(() => ({
      workspacePath: "/active",
    }));

    const target = resolveNewTaskTargetFromRequest({ initialPrompt: "普通NewTask" }, fallback);

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(target).toEqual({ workspacePath: "/active", workspaceIdentity: null });
  });

  it("回退Target带 identity 时原样透传", () => {
    const fallback = vi.fn<[], WorkbenchNewTaskTarget | null>(() => ({
      workspacePath: "/active",
      workspaceIdentity: "remote:ssh:dev:/active",
    }));

    const target = resolveNewTaskTargetFromRequest("cf", fallback);

    expect(target).toEqual({
      workspacePath: "/active",
      workspaceIdentity: "remote:ssh:dev:/active",
    });
  });

  it("provider StringRequest与 undefined Request都走回退，且回退Back null 时透传 null", () => {
    const nullFallback = vi.fn<[], WorkbenchNewTaskTarget | null>(() => null);

    expect(resolveNewTaskTargetFromRequest("cf", nullFallback)).toBeNull();
    expect(resolveNewTaskTargetFromRequest(undefined, nullFallback)).toBeNull();
    expect(nullFallback).toHaveBeenCalledTimes(2);
  });
});

describe("startNewTaskFromActiveWorkspace 接线契About", () => {
  it("newTaskTarget 经 resolveNewTaskTargetFromRequest 解析，惰性包裹 resolveWorkbenchNewTaskTarget", () => {
    const hook = source("../src/root/useRootWorkspaceActions.ts");
    expect(hook).toContain("const newTaskTarget = resolveNewTaskTargetFromRequest(request, () =>");
    expect(hook).toContain("resolveWorkbenchNewTaskTarget({");
    expect(hook).not.toContain("const newTaskTarget = resolveWorkbenchNewTaskTarget(");
  });

  it("Medium枢发From handler 带 target 时SkipEvents workspace 只读Check并透传 targetWorkspace", () => {
    const shell = source("../src/app-shell/WorkspaceShellLayout.tsx");
    expect(shell).toContain("if (!targetWorkspace && workspaceReadOnlyReason) return;");
    expect(shell).toMatch(
      /handleCreateTaskInChat\(\{\s*initialPrompt: prompt,\s*\.\.\.\(targetWorkspace \? \{ targetWorkspace \} : \{\}\),\s*\}\)/,
    );
  });

  it("handleCreateTaskInChat 仅在无 targetWorkspace 时应用Events workspace 只读守卫，带 target 时仍到达 onCreateTask", () => {
    const shell = source("../src/app-shell/WorkspaceShellLayout.tsx");
    expect(shell).toMatch(
      /const hasTargetWorkspace\s*=\s*typeof request === "object" && request !== null && Boolean\(request\.targetWorkspace\);/,
    );
    expect(shell).toMatch(
      /if \(!hasTargetWorkspace && workspaceReadOnlyReason\) \{\s*return;\s*\}\s*showChatMainView\(\);\s*onCreateTask\(request\);/,
    );
    expect(shell).not.toMatch(
      /const handleCreateTaskInChat = useCallback\(\s*\(request\?: [^)]*\) => \{\s*if \(workspaceReadOnlyReason\) \{/,
    );
  });

  it("handleOpenSavedWorkflowRun 用 params 携带的Target workspace 打开Instance，而非EventsProject", () => {
    const shell = source("../src/app-shell/WorkspaceShellLayout.tsx");
    expect(shell).toMatch(
      /const targetWorkspacePath = params\.workspacePath \|\| workspaceAbsPath;/,
    );
    expect(shell).toMatch(/const targetWorkspaceIdentity =\s*params\.workspaceIdentity \?\?/);
    expect(shell).toMatch(/handleOpenWorkflowRun\(\{\s*workspacePath: targetWorkspacePath,/);
    expect(shell).not.toContain(
      "handleSelectTaskInChat(workspaceAbsPath, params.sessionId, workspaceIdentity)",
    );
  });
});
