import { describe, expect, it, vi } from "vitest";
import { requestRemoteProjectConnection } from "@/remote-connection-flow/contract.js";
import { resolveRemoteConnectionPresentation } from "@/lib/remoteConnectionPresentation.js";
const preference = { preferredDirectoryPath: "/repo", preferredProfileId: "dev" };
describe("项目重连意图", () => {
  it("Installation failure retains actual WSL target instead of resetting to default parameters during handover", async () => {
    const resolvedWslTarget = { kind: "wsl", distro: "Ubuntu", user: "dev" } as const;
    const profileId = "17ef20b3-622d-4a53-98c1-0cdff29f3e6d";
    const openWizard = vi.fn();
    await requestRemoteProjectConnection({
      preference,
      presentation: resolveRemoteConnectionPresentation({}),
      reconnect: async () => {
        throw Object.assign(new Error("install required"), {
          code: "source-server-install-required",
          profileId,
          resolvedWslTarget,
        });
      },
      openWizard,
    });
    expect(openWizard).toHaveBeenCalledWith({
      ...preference,
      initialFailure: {
        code: "source-server-install-required",
        message: "install required",
        profileId,
        resolvedWslTarget,
      },
    });
  });
  it("升级失败把 Host 实际 Profile 与原目录一起交给向导", async () => {
    const profileId = "17ef20b3-622d-4a53-98c1-0cdff29f3e6d";
    const openWizard = vi.fn();
    await requestRemoteProjectConnection({
      preference,
      presentation: resolveRemoteConnectionPresentation({}),
      reconnect: async () => {
        throw Object.assign(new Error("upgrade required"), {
          code: "source-server-upgrade-required",
          profileId,
        });
      },
      openWizard,
    });
    expect(openWizard).toHaveBeenCalledWith({
      ...preference,
      initialFailure: {
        code: "source-server-upgrade-required",
        message: "upgrade required",
        profileId,
      },
    });
  });
  it("Complete credentials reuse in-place path without opening wizard or activating new page", async () => {
    const reconnect = vi.fn(async () => undefined);
    const openWizard = vi.fn();
    await requestRemoteProjectConnection({
      preference,
      presentation: resolveRemoteConnectionPresentation({}),
      reconnect,
      openWizard,
    });
    expect(reconnect).toHaveBeenCalledWith({
      activateWorkspaceAfterReconnect: false,
      showErrorToast: false,
      throwOnFailure: true,
      requireStoredCredentials: true,
    });
    expect(openWizard).not.toHaveBeenCalled();
  });
  it("Standard failures stay on project row; viewing failed project displays connection steps directly without redialing", async () => {
    const reconnect = vi.fn(async () => {
      throw Object.assign(new Error("offline"), { code: "remote-host-unreachable" });
    });
    const openWizard = vi.fn();
    await requestRemoteProjectConnection({
      preference,
      presentation: resolveRemoteConnectionPresentation({}),
      reconnect,
      openWizard,
    });
    expect(openWizard).not.toHaveBeenCalled();
    reconnect.mockClear();
    await requestRemoteProjectConnection({
      preference,
      presentation: resolveRemoteConnectionPresentation({
        state: "failed",
        errorCode: "remote-host-unreachable",
      }),
      failure: { message: "offline", code: "remote-host-unreachable", logs: [] },
      reconnect,
      openWizard,
    });
    expect(reconnect).not.toHaveBeenCalled();
    expect(openWizard).toHaveBeenCalledWith(
      expect.objectContaining({
        ...preference,
        initialFailure: expect.objectContaining({ code: "remote-host-unreachable" }),
      }),
    );
  });
  it.each([
    "credentials-required",
    "source-server-install-required",
    "source-server-upgrade-required",
    "source-server-identity-change-pending",
  ])("%s 交接原目录到向导等待点", async (code) => {
    const reconnect = vi.fn(async () => {
      throw Object.assign(new Error(code), { code });
    });
    const openWizard = vi.fn();
    await requestRemoteProjectConnection({
      preference,
      presentation: resolveRemoteConnectionPresentation({}),
      reconnect,
      openWizard,
    });
    expect(openWizard).toHaveBeenCalledWith(
      expect.objectContaining({ ...preference, initialFailure: expect.objectContaining({ code }) }),
    );
  });
});

it("Connecting display for online device with pending project attachment does not mean a reconnect request exists", async () => {
  const reconnect = vi.fn(async () => undefined);
  const openWizard = vi.fn();
  await requestRemoteProjectConnection({
    preference,
    presentation: resolveRemoteConnectionPresentation({ state: "online", attached: false }),
    reconnect,
    openWizard,
  });
  expect(reconnect).toHaveBeenCalledOnce();
  expect(openWizard).not.toHaveBeenCalled();
});
