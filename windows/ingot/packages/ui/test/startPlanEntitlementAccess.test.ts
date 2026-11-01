// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePlanIdentitySnapshot } from "@/hooks/usePlanIdentitySnapshot.js";
import { useV4SessionQuotaBanner } from "@/v4/useV4SessionQuotaBanner.js";
const f = vi.hoisted(() => ({ options: [] as Array<Record<string, unknown>> }));
vi.mock("@/hooks/useProviderSettingsView.js", () => ({
  useProviderSettingsView: () => ({
    state: {
      status: "ready",
      view: {
        revision: 1,
        providers: ["start-plan", "individual-coding-plan", "team-coding-plan"].map((mode) => ({
          providerId: `account:bigmodel-${mode}`,
          effectiveConfig: {
            access: { type: "zhipu-account", accountType: "bigmodel", mode, entitled: true },
          },
        })),
      },
    },
  }),
}));
vi.mock("@/hooks/useUsageEntitlement.js", () => ({
  useUsageEntitlementWithService: (_service: unknown, options: Record<string, unknown>) => {
    f.options.push(options);
    return { snapshot: null, error: null, loading: false, refresh: async () => {} };
  },
}));
afterEach(() => {
  cleanup();
  f.options = [];
});
it("Cold-cache identity stats explicitly query both Start and the selected team; team scope is not lost", () => {
  renderHook(() =>
    usePlanIdentitySnapshot("bigmodel", {
      kind: "team-coding-plan",
      productId: "p",
      organizationId: "o",
      projectId: "j",
    }),
  );
  expect(
    f.options.find((o) => o.preferredProviderId === "account:bigmodel-start-plan")?.accountAccess,
  ).toEqual({ type: "zhipu-account", family: "bigmodel", planKind: "start-plan" });
  expect(
    f.options.find((o) => o.preferredProviderId === "account:bigmodel-team-coding-plan")
      ?.accountAccess,
  ).toEqual({
    type: "zhipu-account",
    family: "bigmodel",
    planKind: "team-coding-plan",
    productId: "p",
    organizationId: "o",
    projectId: "j",
  });
});
it("Session feedback supplements access params via execution Start; stops Start queries when switching to another execution Provider", () => {
  const hook = renderHook(
    ({ providerId }) =>
      useV4SessionQuotaBanner({
        sessionId: "access",
        error: null,
        errorKey: null,
        phase: "idle",
        providerId,
        modelId: "glm-5",
      }),
    { initialProps: { providerId: "account:bigmodel-start-plan" } },
  );
  expect(f.options[0]).toMatchObject({
    enabled: true,
    accountAccess: { type: "zhipu-account", family: "bigmodel", planKind: "start-plan" },
    includeSubscription: true,
  });
  f.options = [];
  hook.rerender({ providerId: "account:bigmodel-team-coding-plan" });
  expect(f.options[0]?.enabled).toBe(false);
});
