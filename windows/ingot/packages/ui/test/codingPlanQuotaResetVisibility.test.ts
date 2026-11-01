import { describe, expect, it } from "vitest";
import type { UsageEntitlementSnapshot, UsageQuotaLimit } from "@origin-ai/cf-shared";
import type { CodingPlanUsageRemainingState } from "@/CodingPlanUsageRemainingPanel.js";
import { resolveChatCodingPlanResetOpportunityBadge } from "@/chat-input-toolbar/codingPlanResetOpportunityBadge.js";
import { buildCodingPlanQuotaResetDialogConfig } from "@/components/coding-plan-quota-reset/buildCodingPlanQuotaResetDialogConfig.js";
import type {
  CodingPlanQuotaResetTypeController,
  CodingPlanQuotaResetUiController,
} from "@/hooks/useCodingPlanQuotaResetUi.js";
import type { CodingPlanQuotaResetUiEntry } from "@/lib/codingPlanQuotaResetUi.js";

const EXPIRES_AT = new Date("2026-08-13T10:20:00+08:00").getTime();

function createEntry(
  overrides: Partial<CodingPlanQuotaResetUiEntry> = {},
): CodingPlanQuotaResetUiEntry {
  return {
    status: "available",
    opportunityCount: 1,
    opportunityExpiresAt: EXPIRES_AT,
    startedAt: null,
    completedAt: null,
    observedAt: null,
    quotaOverridePending: false,
    nextResetAt: null,
    idempotencyKey: null,
    error: null,
    ...overrides,
  };
}

function createTypeController(
  overrides: Partial<CodingPlanQuotaResetTypeController> = {},
): CodingPlanQuotaResetTypeController {
  return {
    entry: null,
    opportunityVisible: false,
    processing: false,
    done: false,
    statusVisible: false,
    reset: async () => undefined,
    ...overrides,
  };
}

function createController(params: {
  fiveHour?: Partial<CodingPlanQuotaResetTypeController>;
  week?: Partial<CodingPlanQuotaResetTypeController>;
}): CodingPlanQuotaResetUiController {
  return {
    ...createTypeController(params.fiveHour),
    enabled: true,
    week: createTypeController(params.week),
    reserveAutomaticCompletion: async () => ({ status: "blocked" }),
    commitAutomaticCompletion: () => false,
    releaseAutomaticCompletion: async () => undefined,
  };
}

function createLimit(usedPercentage: number): UsageQuotaLimit {
  return {
    type: "TOKENS_LIMIT",
    unit: 3,
    number: 5,
    percentage: usedPercentage,
    usageDetails: [],
  } as UsageQuotaLimit;
}

function buildDialog(controller: CodingPlanQuotaResetUiController) {
  return buildCodingPlanQuotaResetDialogConfig({
    fiveHourEnabled: true,
    resetUi: controller,
    usageItems: [],
    weekEnabled: true,
  });
}

function createRemainingState(limits: UsageQuotaLimit[]): CodingPlanUsageRemainingState {
  return {
    displayedEntitlement: null,
    hasAnyActiveCodingPlan: true,
    loading: false,
    providerEntitlements: [],
    tabProviders: [],
    visibleSnapshot: { quota: { limits } } as UsageEntitlementSnapshot,
  };
}

describe("Full-quota visibility of Coding Plan reset chances", () => {
  it("When remaining quota is 100% after reset and multiple chances of the same type exist, keep the reset row and remaining count in modal", () => {
    const dialog = buildDialog(
      createController({
        fiveHour: {
          entry: createEntry({ opportunityCount: 2 }),
          opportunityVisible: true,
        },
      }),
    );

    const fiveHourItem = dialog.resetItems.find((item) => item.resetType === "FIVE_HOUR");
    expect(fiveHourItem).toBeDefined();
    expect(fiveHourItem?.count).toBe(2);
    expect(fiveHourItem?.expiresAt).toBe(EXPIRES_AT);
  });

  it("Keep the reset row even when remaining quota is 100% and only the last chance remains", () => {
    const dialog = buildDialog(
      createController({
        fiveHour: {
          entry: createEntry({ opportunityCount: 1 }),
          opportunityVisible: true,
        },
      }),
    );

    expect(dialog.resetItems.map((item) => item.resetType)).toEqual(["FIVE_HOUR"]);
    expect(dialog.resetItems[0]?.count).toBe(1);
  });

  it("Display both rows when holding both 5-hour and weekly quota chances; do not hide each other due to full quota", () => {
    const dialog = buildDialog(
      createController({
        fiveHour: { entry: createEntry({ opportunityCount: 3 }), opportunityVisible: true },
        week: { entry: createEntry({ opportunityCount: 2 }), opportunityVisible: true },
      }),
    );

    expect(dialog.resetItems.map((item) => [item.resetType, item.count])).toEqual([
      ["FIVE_HOUR", 3],
      ["WEEK", 2],
    ]);
  });

  it("Still hide reset row when no chances are available", () => {
    const dialog = buildDialog(
      createController({
        fiveHour: { entry: createEntry({ opportunityCount: 0 }), opportunityVisible: false },
      }),
    );

    expect(dialog.resetItems).toEqual([]);
  });

  it("processing 与 completed 期间保留重置行，完成反馈不被打断", () => {
    const processing = buildDialog(
      createController({
        fiveHour: {
          entry: createEntry({ status: "processing", startedAt: EXPIRES_AT }),
          opportunityVisible: false,
          processing: true,
        },
      }),
    );
    expect(processing.resetItems.map((item) => item.resetType)).toEqual(["FIVE_HOUR"]);
    expect(processing.resetItems[0]?.processing).toBe(true);

    const completed = buildDialog(
      createController({
        fiveHour: {
          entry: createEntry({
            status: "completed",
            opportunityCount: 0,
            opportunityExpiresAt: null,
            completedAt: EXPIRES_AT,
            quotaOverridePending: true,
          }),
          opportunityVisible: false,
          done: true,
        },
      }),
    );
    expect(completed.resetItems.map((item) => item.resetType)).toEqual(["FIVE_HOUR"]);
  });

  it("Chat input chance badge still displays remaining count when quota is at 100%", () => {
    const badge = resolveChatCodingPlanResetOpportunityBadge(
      createRemainingState([createLimit(0)]),
      {
        entry: createEntry({ opportunityCount: 2 }),
        opportunityVisible: true,
        week: createTypeController(),
      },
    );

    expect(badge).toEqual({ count: 2, expiresAt: EXPIRES_AT, visible: true });
  });

  it("Keep badge hidden when there is no corresponding quota bar or no available chances", () => {
    expect(
      resolveChatCodingPlanResetOpportunityBadge(createRemainingState([]), {
        entry: createEntry({ opportunityCount: 2 }),
        opportunityVisible: true,
        week: createTypeController(),
      }),
    ).toEqual({ count: 0, expiresAt: null, visible: false });

    expect(
      resolveChatCodingPlanResetOpportunityBadge(createRemainingState([createLimit(0)]), {
        entry: createEntry({ opportunityCount: 0 }),
        opportunityVisible: false,
        week: createTypeController(),
      }),
    ).toEqual({ count: 0, expiresAt: null, visible: false });
  });
});
