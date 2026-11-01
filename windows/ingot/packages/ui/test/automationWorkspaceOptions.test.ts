import { describe, expect, it } from "vitest";
import {
  findAutomationWorkspaceOptionByKey,
  reconcileAutomationWorkspaceSelectionKey,
  resolveAutomationWorkspaceSelectionKey,
} from "@/settings/automationWorkspaceOptions.js";
describe("automation project selection", () => {
  it("uses project identity for overlapping cwd, without changing workspace identity", () => {
    const options = [
      { projectId: "a", hostId: "local", workspacePath: "/same", label: "A" },
      { projectId: "b", hostId: "local", workspacePath: "/same", label: "B" },
    ];
    const key = resolveAutomationWorkspaceSelectionKey(options[1]!);
    expect(key).not.toBe(resolveAutomationWorkspaceSelectionKey(options[0]!));
    expect(findAutomationWorkspaceOptionByKey(options, key)).toBe(options[1]);
    expect(options[1]!.workspacePath).toBe("/same");
    expect(reconcileAutomationWorkspaceSelectionKey(options, key)).toBe(key);
  });
  it("Fallback selection to null when no valid project exists; do not fall back to default or conversation workspace", () => {
    expect(
      reconcileAutomationWorkspaceSelectionKey([], "/app/default", {
        workspacePath: "/app/default",
      }),
    ).toBeNull();
  });

  it("Prefer valid default project upon candidate recovery, while keeping the currently valid project", () => {
    const options = [
      { workspacePath: "/repo/first", label: "first" },
      {
        workspacePath: "/repo",
        workspaceIdentity: "remote:ssh:b:/repo",
        label: "remote-b",
      },
    ];

    expect(
      reconcileAutomationWorkspaceSelectionKey(options, null, {
        workspacePath: "/repo",
        workspaceIdentity: "remote:ssh:b:/repo",
      }),
    ).toBe("remote:ssh:b:/repo");
    expect(
      reconcileAutomationWorkspaceSelectionKey(options, "/repo/first", {
        workspacePath: "/repo",
        workspaceIdentity: "remote:ssh:b:/repo",
      }),
    ).toBe("/repo/first");
  });
});
