import { describe, expect, it, vi } from "vitest";
import { createRemoteProviderProvisioningExecutor } from "../src/host/remoteProviderProvisioningService.js";

describe("Remote Provider Provisioning Host facade", () => {
  it("Successful results do not carry unknown error codes attached by the remote, preventing Host schema from dropping success responses", async () => {
    const service = createRemoteProviderProvisioningExecutor({
      source: { read: vi.fn(async () => ({ syncId: "fixture" })) } as never,
      target: {
        apply: vi.fn(async () => ({
          syncId: "fixture",
          status: "applied",
          personalProviderCount: 0,
          credentialCount: 0,
          rolledBack: false,
          errorCode: "token=fixture-secret",
        })),
      } as never,
    });
    const result = await service.syncLocalToRemote();
    expect(result.status).toBe("applied");
    expect(result).not.toHaveProperty("errorCode");
  });

  it.each(["source", "target"])("%s error throwing preserves safe failure stage", async (stage) => {
    const source = {
      read: vi.fn(async () => {
        if (stage === "source") throw new Error("token=fixture-secret");
        return { syncId: "fixture" };
      }),
    };
    const target = {
      apply: vi.fn(async () => {
        throw new Error("token=fixture-secret");
      }),
    };
    const service = createRemoteProviderProvisioningExecutor({ source: source as never, target });
    expect(await service.syncLocalToRemote()).toMatchObject({
      status: "failed",
      errorCode: stage === "source" ? "source-read-failed" : "target-call-failed",
    });
    expect(target.apply).toHaveBeenCalledTimes(stage === "source" ? 0 : 1);
  });

  it.each([undefined, "target-refresh-failed", "token=fixture-secret"])(
    "Target error code %s only passes through the allowlist; compatible with legacy targets",
    async (errorCode) => {
      const target = {
        apply: vi.fn(async () => ({
          syncId: "fixture",
          status: "failed",
          personalProviderCount: 0,
          credentialCount: 0,
          rolledBack: true,
          errorCode,
        })),
      };
      const service = createRemoteProviderProvisioningExecutor({
        source: { read: vi.fn(async () => ({ syncId: "fixture" })) } as never,
        target: target as never,
      });
      expect(await service.syncLocalToRemote()).toMatchObject({
        status: "failed",
        errorCode: errorCode === "target-refresh-failed" ? errorCode : "target-apply-failed",
      });
    },
  );

  it("does not send a secret when the target is unsupported", async () => {
    const source = { read: vi.fn() };
    const service = createRemoteProviderProvisioningExecutor({ source, target: undefined });

    await expect(service.syncLocalToRemote()).resolves.toMatchObject({
      status: "unsupported",
      rolledBack: false,
    });
    expect(source.read).not.toHaveBeenCalled();
  });

  it("reads and applies one complete source envelope", async () => {
    const envelope = { syncId: "source-sync" };
    const source = { read: vi.fn(async () => envelope) };
    const target = {
      apply: vi.fn(async (envelope: unknown) => ({
        syncId: (envelope as { syncId: string }).syncId,
        status: "applied" as const,
        personalProviderCount: 1,
        credentialCount: 1,
        registryRevision: "target-1",
        rolledBack: false,
      })),
    };
    const service = createRemoteProviderProvisioningExecutor({ source, target });

    await expect(service.syncLocalToRemote()).resolves.toMatchObject({
      status: "applied",
      syncId: "source-sync",
    });
    expect(source.read).toHaveBeenCalledOnce();
    expect(target.apply).toHaveBeenCalledWith(envelope);
  });
});
