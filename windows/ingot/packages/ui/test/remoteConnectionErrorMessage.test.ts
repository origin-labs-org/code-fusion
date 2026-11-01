import { describe, expect, it } from "vitest";
import {
  formatRemoteConnectionError,
  shouldShowStandaloneRemoteErrorToast,
} from "@/lib/remoteConnectionPresentation.js";

describe("formatRemoteConnectionError", () => {
  const formatMessage = ({ id }: { id: string }) => id;

  it("maps public reason codes and preserves the Host retryable contract", () => {
    expect(
      formatRemoteConnectionError({
        fallback: "raw english error",
        reasonCode: "source-server-upgrade-required",
        retryable: false,
        formatMessage,
      }),
    ).toBe("remote.error.sourceServerUpgradeRequired");
    expect(
      formatRemoteConnectionError({
        fallback: "raw english error",
        reasonCode: "workspace-task-identity-conflict",
        retryable: true,
        formatMessage,
      }),
    ).toBe("remote.error.workspaceTaskIdentityConflict remote.error.retryableHint");
  });

  it("Falls back to generic translation for unknown error codes", () => {
    expect(
      formatRemoteConnectionError({
        fallback: "socket closed",
        reasonCode: "private-internal-code",
        formatMessage,
      }),
    ).toBe("remote.error.unknown");
  });

  it("interpolates recovery attempt values for a budget exhaustion code", () => {
    expect(
      formatRemoteConnectionError({
        fallback: "socket closed",
        reasonCode: "remote-recovery-budget-exhausted",
        recoveryAttempt: 3,
        recoveryLimit: 3,
        formatMessage: ({ id }, values) =>
          id === "remote.error.recoveryBudgetExhausted"
            ? `stopped after ${values?.attempt}/${values?.limit}`
            : id,
      }),
    ).toBe("stopped after 3/3");
  });

  it("Version blocking delegates to authoritative prompt with update action, no longer showing bare errors", () => {
    expect(shouldShowStandaloneRemoteErrorToast("source-server-upgrade-required")).toBe(false);
    expect(shouldShowStandaloneRemoteErrorToast("remote-bind-canceled")).toBe(true);
  });
});
