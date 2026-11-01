import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ICfAgentService,
  CfAgentRunAutomationNowResult,
} from "@origin-ai/cf-services";
import type { CfAutomation } from "@origin-ai/cf-shared";
import { useAutomationManagementStore } from "@/store/automationManagementStore.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("automationManagementStore runAutomationNow", () => {
  afterEach(() => {
    useAutomationManagementStore.setState(
      useAutomationManagementStore.getInitialState(),
      true,
    );
  });

  it("Send only one RPC when triggering run-now repeatedly for the same automation", async () => {
    const pendingRun = deferred<CfAgentRunAutomationNowResult>();
    const agentService = {
      runAutomationNow: vi.fn(() => pendingRun.promise),
      listAllAutomations: vi.fn(async () => []),
    } as unknown as ICfAgentService;

    useAutomationManagementStore.setState({
      workspacePath: "/tmp/ws",
      workspaceIdentity: null,
    });

    const first = useAutomationManagementStore
      .getState()
      .runAutomationNow("automation-1", agentService);
    const duplicate = await useAutomationManagementStore
      .getState()
      .runAutomationNow("automation-1", agentService);

    expect(duplicate).toBe("duplicate");
    expect(agentService.runAutomationNow).toHaveBeenCalledTimes(1);

    pendingRun.resolve({ status: "queued" });

    await expect(first).resolves.toBe("queued");
    expect(agentService.listAllAutomations).toHaveBeenCalledTimes(1);
  });

  it("Do not falsely report queued or refresh the list when the host rejects duplicate run-now requests", async () => {
    const agentService = {
      runAutomationNow: vi.fn(async () => ({ status: "duplicate" as const })),
      listAllAutomations: vi.fn(async () => []),
    } as unknown as ICfAgentService;

    useAutomationManagementStore.setState({
      workspacePath: "/tmp/ws",
      workspaceIdentity: null,
    });

    await expect(
      useAutomationManagementStore
        .getState()
        .runAutomationNow("automation-1", agentService),
    ).resolves.toBe("duplicate");
    expect(agentService.runAutomationNow).toHaveBeenCalledTimes(1);
    expect(agentService.listAllAutomations).not.toHaveBeenCalled();
  });

  it("Restore entry point after RPC returns; delegate duplicate triggers of active runs to host determination", async () => {
    const agentService = {
      runAutomationNow: vi
        .fn()
        .mockResolvedValueOnce({ status: "queued" as const })
        .mockResolvedValueOnce({ status: "duplicate" as const }),
      listAllAutomations: vi.fn(async () => []),
    } as unknown as ICfAgentService;

    useAutomationManagementStore.setState({
      workspacePath: "/tmp/ws",
      workspaceIdentity: null,
    });

    await expect(
      useAutomationManagementStore
        .getState()
        .runAutomationNow("automation-1", agentService),
    ).resolves.toBe("queued");
    await expect(
      useAutomationManagementStore
        .getState()
        .runAutomationNow("automation-1", agentService),
    ).resolves.toBe("duplicate");
    expect(agentService.runAutomationNow).toHaveBeenCalledTimes(2);
  });

  it("Use automation\'s own workspace when toggling cross-project automations, and flip status locally", async () => {
    const automation = {
      automationId: "automation-remote",
      title: "remote task",
      cronExpr: "*/5 * * * *",
      prompt: "ping",
      workspacePath: "/tmp/remote",
      workspaceIdentity: "ssh://remote/tmp/remote",
      enabled: true,
      lifecycleStatus: "active",
      nextRunAt: Date.now() + 60_000,
      runCount: 0,
      recurring: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies CfAutomation;
    const agentService = {
      setAutomationEnabled: vi.fn(async () => undefined),
      listAllAutomations: vi.fn(async () => [
        { ...automation, enabled: false, lifecycleStatus: "paused" as const },
      ]),
    } as unknown as ICfAgentService;

    useAutomationManagementStore.setState({
      workspacePath: "/tmp/current",
      workspaceIdentity: null,
      automations: [automation],
    });

    await useAutomationManagementStore
      .getState()
      .setEnabled("automation-remote", false, agentService);

    expect(agentService.setAutomationEnabled).toHaveBeenCalledWith({
      workspacePath: "/tmp/remote",
      workspaceIdentity: "ssh://remote/tmp/remote",
      automationId: "automation-remote",
      enabled: false,
    });
    expect(useAutomationManagementStore.getState().automations[0]).toEqual(
      expect.objectContaining({
        enabled: false,
        lifecycleStatus: "paused",
      }),
    );
  });
});
