import { describe, expect, it } from "vitest";
import { resolveRemoteConnectionPresentation } from "@/lib/remoteConnectionPresentation.js";

describe("远程连接展示合同", () => {
  it("Active disconnect overrides retained errors and upgrade gate", () => {
    expect(
      resolveRemoteConnectionPresentation({
        state: "failed",
        disconnectOrigin: "user",
        errorCode: "source-server-upgrade-required",
      }),
    ).toMatchObject({
      status: "offline",
      shortMessageId: "remote.status.offline",
      tone: "neutral",
      icon: "cloud-off",
      primaryAction: "connect",
    });
  });
});

it.each([
  [{ state: "online", attached: true }, "online", "online", "success", "cloud", "disconnect"],
  [{ state: "online", attached: false }, "connecting", "connecting", "progress", "spinner", "none"],
  [{ state: "bootstrapping" }, "connecting", "connecting", "progress", "spinner", "none"],
  [
    { state: "retrying", recoveryAttempt: 2, recoveryLimit: 3 },
    "connecting",
    "connecting",
    "progress",
    "spinner",
    "none",
  ],
  [
    { state: "updating", errorCode: "source-server-upgrade-required" },
    "connecting",
    "updating",
    "progress",
    "spinner",
    "none",
  ],
  [{ state: "offline" }, "offline", "offline", "neutral", "cloud-off", "connect"],
  [
    { state: "absent", disconnectOrigin: "startup" },
    "offline",
    "offline",
    "neutral",
    "cloud-off",
    "connect",
  ],
  [{ state: "needs-install" }, "pending", "needsInstall", "warning", "cloud-alert", "install"],
  [
    { state: "needs-upgrade", upgradeTarget: "server" },
    "pending",
    "needsUpdate",
    "warning",
    "cloud-alert",
    "update-server",
  ],
  [
    { state: "needs-upgrade", upgradeTarget: "controller" },
    "pending",
    "needsUpdate",
    "warning",
    "cloud-alert",
    "update-desktop",
  ],
  [
    { state: "identity-change-pending" },
    "pending",
    "needsIdentity",
    "warning",
    "cloud-alert",
    "confirm-identity",
  ],
  [
    { state: "failed", credentialsMissing: true },
    "pending",
    "needsCredentials",
    "warning",
    "cloud-alert",
    "credentials",
  ],
  [
    { state: "failed", errorCode: "remote-connection-timeout" },
    "failed",
    "failed",
    "danger",
    "cloud-x",
    "retry",
  ],
  [
    { state: "offline", recoveryBudgetExhausted: true },
    "failed",
    "failed",
    "danger",
    "cloud-x",
    "retry",
  ],
  [
    { state: "online", updateAvailability: "available" },
    "online",
    "online",
    "success",
    "cloud",
    "disconnect",
  ],
  [
    { state: "failed", errorCode: "remote-connection-canceled" },
    "offline",
    "offline",
    "neutral",
    "cloud-off",
    "connect",
  ],
] as const)("投影 %j", (input, status, short, tone, icon, action) => {
  expect(resolveRemoteConnectionPresentation(input)).toMatchObject({
    status,
    shortMessageId: `remote.status.${short}`,
    tone,
    icon,
    primaryAction: action,
  });
});

import { classifyRemoteConnectionError } from "@/lib/remoteConnectionPresentation.js";
import { PUBLIC_CF_ERROR_CODES } from "@origin-ai/cf-shared";

it.each([
  ["remote-authentication-failed", "authentication", "edit-auth"],
  ["remote-host-unreachable", "hostUnreachable", "retry"],
  ["remote-connection-timeout", "connectionTimeout", "retry"],
  ["remote-host-not-found", "hostNotFound", "edit-host"],
  ["remote-host-key-changed", "hostKeyChanged", "security"],
  ["remote-download-failed", "downloadFailed", "retry"],
  ["remote-upload-failed", "uploadFailed", "retry"],
  ["remote-preflight-failed", "preflightFailed", "retry"],
  ["remote-install-failed", "installFailed", "retry"],
  ["remote-space-insufficient", "spaceInsufficient", "details"],
  ["remote-permission-denied", "permissionDenied", "details"],
  ["remote-connection-canceled", "connectionCanceled", "connect"],
  ["remote-connection-unknown", "unknown", "retry"],
] as const)("错误 %s 给出原因与操作", (errorCode, title, primaryAction) => {
  expect(classifyRemoteConnectionError({ errorCode })).toMatchObject({
    titleId: `remote.error.${title}`,
    primaryAction,
  });
});
it.each(PUBLIC_CF_ERROR_CODES)("Public error code %s has an explicit mapping", (errorCode) => {
  expect(classifyRemoteConnectionError({ errorCode }).category).not.toBe("unrecognized");
});
it.each([undefined, "", "future-error"])("Safe fallback for unknown error %s", (errorCode) => {
  expect(classifyRemoteConnectionError({ errorCode })).toMatchObject({
    titleId: "remote.error.unknown",
    primaryAction: "retry",
  });
});
it.each(["local-download-upload", "remote-download"] as const)(
  "SSH download method %s determines switch suggestion",
  (assetInstallMode) => {
    expect(
      classifyRemoteConnectionError({
        errorCode: "remote-download-failed",
        target: { kind: "ssh", host: "host", username: "dev", assetInstallMode },
      }).allowRemoteDownload,
    ).toBe(assetInstallMode === "local-download-upload");
  },
);
it.each([
  { kind: "wsl", distro: "Ubuntu" },
  { kind: "docker", container: "app" },
] as const)("%j uses dedicated copy without prompting remote download", (target) => {
  expect(
    classifyRemoteConnectionError({ errorCode: "remote-host-not-found", target }),
  ).toMatchObject({
    titleId: `remote.error.hostNotFound.${target.kind}`,
    allowRemoteDownload: false,
  });
});

it("Project-level failure retains owner-classified reason and is not overwritten by device online or unknown error templates", () => {
  const presentation = resolveRemoteConnectionPresentation({
    state: "online",
    attached: false,
    projectError: "The remote directory is unavailable. Please check if it exists.",
  });
  expect(presentation.status).toBe("failed");
  expect(presentation.reasonText).toBe("The remote directory is unavailable. Please check if it exists.");
});
