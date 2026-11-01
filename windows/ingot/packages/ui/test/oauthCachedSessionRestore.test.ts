import { describe, expect, it, vi } from "vitest";
import { applyCachedOAuthSessionRestoreResult } from "@/root/oauthCachedSessionRestore.js";

describe("applyCachedOAuthSessionRestoreResult", () => {
  it("clears the displayed user, shows one expiry alert, then opens reauthentication", async () => {
    const setUser = vi.fn();
    const requestAlert = vi.fn(async () => undefined);
    const onReauthenticationRequired = vi.fn();

    await applyCachedOAuthSessionRestoreResult({
      result: {
        status: "reauthentication-required",
        reason: "jwt-expired",
      },
      setUser,
      requestAlert,
      onReauthenticationRequired,
      copy: {
        title: "登录已过期",
        description: "To protect your account security, please log in again.",
        actionLabel: "Log In Again",
      },
    });

    expect(setUser).toHaveBeenCalledWith(null);
    expect(requestAlert).toHaveBeenCalledTimes(1);
    expect(requestAlert).toHaveBeenCalledWith({
      title: "登录已过期",
      description: "To protect your account security, please log in again.",
      actionLabel: "Log In Again",
    });
    expect(onReauthenticationRequired).toHaveBeenCalledTimes(1);
    expect(requestAlert.mock.invocationCallOrder[0]).toBeLessThan(
      onReauthenticationRequired.mock.invocationCallOrder[0],
    );
  });
});
