import { describe, expect, it, vi } from "vitest";
import { ensureTaskNavigationWorkspace } from "@/app-shell/taskNavigationWorkspace.js";

describe("ensureTaskNavigationWorkspace", () => {
  it("Reuse open exact workspace tab", () => {
    const activateTabByPath = vi.fn(() => true);
    const addLocalWorkspaceTab = vi.fn();

    expect(
      ensureTaskNavigationWorkspace({
        workspacePath: "/workspace/project",
        activateTabByPath,
        addLocalWorkspaceTab,
      }),
    ).toEqual({ accepted: true, openedLocalTab: false });
    expect(addLocalWorkspaceTab).not.toHaveBeenCalled();
  });

  it("运行历史属于已关闭的本地项目时补开 workspace tab", () => {
    const activateTabByPath = vi.fn(() => false);
    const addLocalWorkspaceTab = vi.fn();

    expect(
      ensureTaskNavigationWorkspace({
        workspacePath: "/workspace/closed-project",
        activateTabByPath,
        addLocalWorkspaceTab,
      }),
    ).toEqual({ accepted: true, openedLocalTab: true });
    expect(addLocalWorkspaceTab).toHaveBeenCalledWith("/workspace/closed-project");
  });

  it("Remote workspaces lacking current window attachment are not reopened by path", () => {
    const activateTabByPath = vi.fn(() => false);
    const addLocalWorkspaceTab = vi.fn();

    expect(
      ensureTaskNavigationWorkspace({
        workspacePath: "/home/project",
        workspaceIdentity: "ssh://host/home/project",
        activateTabByPath,
        addLocalWorkspaceTab,
      }),
    ).toEqual({ accepted: false, reason: "remote_attachment_missing" });
    expect(activateTabByPath).toHaveBeenCalledWith("/home/project", {
      workspaceIdentity: "ssh://host/home/project",
    });
    expect(addLocalWorkspaceTab).not.toHaveBeenCalled();
  });
});
