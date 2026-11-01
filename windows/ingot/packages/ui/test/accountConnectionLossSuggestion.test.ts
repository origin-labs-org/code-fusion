import { describe, expect, it, vi } from "vitest";
import { prepareAccountConnectionSwitch } from "@/root/accountConnectionLossSuggestion.js";

function fixture() {
  let valid = true;
  let settings = {
    providerFamilyDomain: "bigmodel",
    providerFamilyConnectionSelections: {
      bigmodel: {
        kind: "team-coding-plan",
        organizationId: "old-org",
        projectId: "old-project",
        productId: "old-product",
      },
    },
  };
  const view = {
    revision: 1,
    providers: [
      {
        providerId: "account:bigmodel-team-coding-plan",
        accountState: {
          current: true,
          connectionKey: "account/start",
          availability: "unavailable",
        },
      },
      {
        providerId: "account:bigmodel-individual-coding-plan",
        accountState: { current: false, availability: "available" },
      },
    ],
  };
  const services = {
    settingService: {
      get: vi.fn(async () => structuredClone(settings)),
      update: vi.fn(async (patch) => {
        settings = { ...settings, ...patch };
      }),
    },
    providerSettingsService: { getView: vi.fn(async () => view), refresh: vi.fn(async () => view) },
    codingPlanSubscriptionService: {
      getEnterprisePricing: vi.fn(async () => ({ productList: [] })),
    },
    usageStatsService: { getEntitlementSnapshot: vi.fn() },
  };
  const event = {
    providerId: "account:bigmodel-team-coding-plan",
    connectionKey: "account/start",
    isCurrent: () => valid,
  };
  return {
    services,
    event,
    view,
    invalidate: () => {
      valid = false;
    },
  };
}

describe("Plan switch recommendation", () => {
  it("付费失效时不推荐把全局连接改成 Start", async () => {
    const { services, event, view } = fixture();
    view.providers[1]!.providerId = "account:bigmodel-start-plan";
    expect(await prepareAccountConnectionSwitch(services as never, event)).toBeNull();
    expect(services.settingService.update).not.toHaveBeenCalled();
  });
  it("Validate specific items for Team recommendations; clicking will not switch to another Team", async () => {
    const { services, event, view } = fixture();
    view.providers[1]!.accountState.availability = "unavailable";
    services.codingPlanSubscriptionService.getEnterprisePricing.mockResolvedValue({
      productList: [
        {
          productId: "product",
          subscribed: true,
          teamProjects: [
            { organizationId: "org-a", projectId: "project-a", organizationName: "团队 A" },
            { organizationId: "org-b", projectId: "project-b", organizationName: "团队 B" },
          ],
        },
      ],
    } as never);
    services.usageStatsService.getEntitlementSnapshot.mockImplementation(
      async ({ accountAccess }) =>
        accountAccess.projectId === "project-b"
          ? {
              subscription: {
                identityType: "unknown",
                identityMasked: null,
                details: [{ productId: "product", productName: "团队 B" }],
              },
            }
          : { unavailableReason: "no_plan" },
    );
    const suggestion = await prepareAccountConnectionSwitch(services as never, event);
    expect(suggestion?.label).toBe("团队 B");
    expect(suggestion?.selection).toEqual({
      kind: "team-coding-plan",
      productId: "product",
      organizationId: "org-b",
      projectId: "project-b",
    });
    services.usageStatsService.getEntitlementSnapshot.mockResolvedValue({
      unavailableReason: "no_plan",
    });
    expect(await suggestion?.apply()).toBe("stale");
    expect(services.settingService.update).not.toHaveBeenCalled();
  });
  it("Old expiration recommendations cannot be submitted after reselection with the same identity produces a newer operation", async () => {
    const { services, event } = fixture();
    const suggestion = await prepareAccountConnectionSwitch(services as never, event);
    services.settingService.update.mockImplementationOnce(async (_patch, expected) => {
      if (expected?.providerFamilyDomainUpdatedAt !== 1)
        throw new Error("Account connection settings changed");
    });
    await expect(suggestion?.apply()).rejects.toThrow("Account connection settings changed");
    expect(services.settingService.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ providerFamilyDomainUpdatedAt: 0 }),
    );
  });
  it("Still return saved if write succeeds but refresh fails", async () => {
    const { services, event, view } = fixture();
    const suggestion = await prepareAccountConnectionSwitch(services as never, event);
    services.providerSettingsService.refresh
      .mockResolvedValueOnce(view)
      .mockRejectedValueOnce(new Error("offline"));
    expect(await suggestion?.apply()).toBe("switched");
    expect(services.settingService.update).toHaveBeenCalledOnce();
  });
  it("Do not submit old recommendations if intent switches or clicks repeat while waiting for refresh", async () => {
    const { services, event, view, invalidate } = fixture();
    const suggestion = await prepareAccountConnectionSwitch(services as never, event);
    let finish!: (value: typeof view) => void;
    services.providerSettingsService.refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = suggestion!.apply();
    expect(await suggestion!.apply()).toBe("stale");
    invalidate();
    finish(view);
    expect(await pending).toBe("stale");
    expect(services.settingService.update).not.toHaveBeenCalled();
  });
  it("Compute does not write; conditionally save on click only, and repeated clicks do not repeat writes", async () => {
    const { services, event } = fixture();
    const suggestion = await prepareAccountConnectionSwitch(services as never, event);
    expect(suggestion?.selection).toEqual({ kind: "individual-coding-plan" });
    expect(services.settingService.update).not.toHaveBeenCalled();
    expect(await suggestion?.apply()).toBe("switched");
    expect(services.settingService.update).toHaveBeenCalledWith(
      expect.objectContaining({
        providerFamilyConnectionSelections: { bigmodel: { kind: "individual-coding-plan" } },
      }),
      expect.objectContaining({
        providerFamilyConnectionSelections: {
          bigmodel: {
            kind: "team-coding-plan",
            organizationId: "old-org",
            projectId: "old-project",
            productId: "old-product",
          },
        },
      }),
    );
    await suggestion?.apply();
    expect(services.settingService.update).toHaveBeenCalledTimes(1);
  });
  it.each(["intent", "recovered", "target"])("%s 改变后旧按钮不再提交", async (kind) => {
    const { services, event, view, invalidate } = fixture();
    const suggestion = await prepareAccountConnectionSwitch(services as never, event);
    if (kind === "intent") invalidate();
    if (kind === "recovered") view.providers[0]!.accountState.availability = "available";
    if (kind === "target") view.providers[1]!.accountState.availability = "unavailable";
    expect(await suggestion?.apply()).toBe("stale");
    expect(services.settingService.update).not.toHaveBeenCalled();
  });
  it("Do not use purchase portal as alternative when no target is available", async () => {
    const { services, event, view } = fixture();
    view.providers[1]!.accountState.availability = "unavailable";
    expect(await prepareAccountConnectionSwitch(services as never, event)).toBeNull();
    expect(services.settingService.update).not.toHaveBeenCalled();
  });
  it("Throw operation error on save failure instead of claiming success", async () => {
    const { services, event } = fixture();
    services.settingService.update.mockRejectedValueOnce(new Error("disk"));
    const suggestion = await prepareAccountConnectionSwitch(services as never, event);
    await expect(suggestion?.apply()).rejects.toThrow("disk");
  });
});
