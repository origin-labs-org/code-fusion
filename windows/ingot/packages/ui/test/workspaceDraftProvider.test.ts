import { describe, expect, it } from "vitest";
import { createDefaultWorkspaceState } from "@/store/cfSessionStoreTypes.js";
import { resolveWorkspaceSwitchDraftProvider } from "@/lib/workspaceDraftProvider.js";

describe("workspace draft provider", () => {
  it("切换到已有Status的 workspace 时会RetainTarget workspace 自己记住的 provider", () => {
    expect(
      resolveWorkspaceSwitchDraftProvider({
        currentSelectedProvider: "claude",
        targetWorkspacePath: "/tmp/workspace-b",
        workspaces: {
          "/tmp/workspace-b": createDefaultWorkspaceState("codex"),
        },
      }),
    ).toBe("codex");
  });

  it("切换到首次打开的 workspace 时会继承Current workspace 的 provider", () => {
    expect(
      resolveWorkspaceSwitchDraftProvider({
        currentSelectedProvider: "gemini",
        targetWorkspacePath: "/tmp/workspace-c",
        workspaces: {},
      }),
    ).toBe("gemini");
  });
});
