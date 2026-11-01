import { describe, expect, it } from "vitest";
import { isPluginScopeWorkspaceConnected } from "@/settings/PluginScopeMenu.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

describe("Plugin settings section", () => {
  it("Only include available local projects and connected remote projects in Scope", () => {
    const workspace = (overrides: Partial<WorkspaceTabState>) =>
      ({
        id: "workspace-1",
        kind: "workspace",
        label: "Workspace",
        workspacePath: "/workspace",
        ...overrides,
      }) as WorkspaceTabState;

    expect(isPluginScopeWorkspaceConnected(workspace({}))).toBe(true);
    expect(
      isPluginScopeWorkspaceConnected(workspace({ availability: "unavailable-local-directory" })),
    ).toBe(false);
    expect(
      isPluginScopeWorkspaceConnected(
        workspace({ workspaceIdentity: "remote:ssh:host:/workspace" }),
      ),
    ).toBe(false);
    expect(
      isPluginScopeWorkspaceConnected(
        workspace({
          workspaceIdentity: "remote:ssh:host:/workspace",
          remoteSessionId: "remote-session-1",
        }),
      ),
    ).toBe(true);
  });
});
