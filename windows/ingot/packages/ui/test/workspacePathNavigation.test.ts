// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addWorkspacePathOpenRequestListener,
  requestWorkspacePathOpen,
  selectWorkspacePathFileService,
  shouldFallbackWorkspacePathToCodeViewer,
} from "@/lib/workspacePathNavigation.js";

describe("workspacePathNavigation", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  it("把 Base Local Memory Table of ContentsRequest交To已挂载的 Workspace Shell", () => {
    const listener = vi.fn();
    cleanups.push(addWorkspacePathOpenRequestListener(listener));

    requestWorkspacePathOpen({
      label: "z-code",
      path: "/data/memories/projects/z-code/memory",
      serviceScope: "base-local",
    });

    expect(listener).toHaveBeenCalledWith({
      label: "z-code",
      path: "/data/memories/projects/z-code/memory",
      serviceScope: "base-local",
    });
  });

  it("Memory Table of Contents固定选择 Base Local FileService", () => {
    const workspaceFileService = { id: "remote" };
    const baseFileService = { id: "local" };

    expect(
      selectWorkspacePathFileService(
        { label: "memory", path: "/memory", serviceScope: "base-local" },
        workspaceFileService,
        baseFileService,
      ),
    ).toBe(baseFileService);
    expect(
      selectWorkspacePathFileService(
        { label: "workspace", path: "/workspace" },
        workspaceFileService,
        baseFileService,
      ),
    ).toBe(workspaceFileService);
  });

  it("Memory Table of Contents打开Failed时不误降级成File CodeViewer", () => {
    expect(
      shouldFallbackWorkspacePathToCodeViewer({
        label: "memory",
        path: "/missing-memory",
        serviceScope: "base-local",
      }),
    ).toBe(false);
    expect(
      shouldFallbackWorkspacePathToCodeViewer({
        label: "README.md",
        path: "/workspace/README.md",
      }),
    ).toBe(true);
  });
});
