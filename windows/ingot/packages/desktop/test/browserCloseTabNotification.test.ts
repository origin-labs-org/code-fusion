import { describe, expect, it } from "vitest";
import { buildBrowserViewCloseTabNotification } from "../src/main/browserView/browserCloseTabNotification.js";

describe("buildBrowserViewCloseTabNotification", () => {
  it("Owner of remote workspace maps field-by-field to scope routable by renderer", () => {
    expect(
      buildBrowserViewCloseTabNotification("browser:tab-a", {
        workspaceKey: "ssh://host/repo",
        sessionId: "session-a",
        remoteSessionId: "remote-a",
      }),
    ).toEqual({
      tabId: "browser:tab-a",
      workspaceKey: "ssh://host/repo",
      sessionId: "session-a",
      remoteSessionId: "remote-a",
    });
  });

  it("Local workspace omits remoteSessionId key entirely instead of setting it to undefined", () => {
    const notification = buildBrowserViewCloseTabNotification("browser:tab-b", {
      workspaceKey: "/repo",
      sessionId: "session-b",
    });

    expect(notification).toEqual({
      tabId: "browser:tab-b",
      workspaceKey: "/repo",
      sessionId: "session-b",
    });
    expect(Object.hasOwn(notification, "remoteSessionId")).toBe(false);
  });

  it("Empty string remoteSessionId is treated as absent to prevent renderer from misidentifying remote on empty scope", () => {
    const notification = buildBrowserViewCloseTabNotification("browser:tab-c", {
      workspaceKey: "/repo",
      sessionId: "session-c",
      remoteSessionId: "",
    });

    expect(Object.hasOwn(notification, "remoteSessionId")).toBe(false);
  });

  it("Carry only tabId when owner is absent, preserving \"current workspace only\" semantics for recovery-orphan path", () => {
    const notification = buildBrowserViewCloseTabNotification("browser:tab-d");

    expect(notification).toEqual({ tabId: "browser:tab-d" });
    expect(Object.hasOwn(notification, "workspaceKey")).toBe(false);
    expect(Object.hasOwn(notification, "sessionId")).toBe(false);
  });
});
