import { describe, expect, it } from "vitest";
import type { CodingPlanResetStatusSnapshot, UsageQuotaLimit } from "@origin-ai/cf-shared";
import {
  CODING_PLAN_QUOTA_RESET_AUTOMATIC_PROCESSING_MS,
  CODING_PLAN_QUOTA_RESET_DONE_DISPLAY_MS,
  advanceCodingPlanQuotaResetCelebration,
  applyCodingPlanQuotaResetStatus,
  completeCodingPlanQuotaResetEntitlementRefresh,
  failCodingPlanQuotaResetManualUse,
  hasUsableCodingPlanQuotaResetOpportunity,
  startCodingPlanQuotaResetManualUse,
  resolveCodingPlanQuotaResetActionCompletedAt,
  resolveCodingPlanQuotaResetAutomaticPhase,
  resolveCodingPlanQuotaResetLimit,
  resolveCodingPlanQuotaResetRemainingPercentage,
  resolveCodingPlanQuotaResetStatusVisible,
  mergeCodingPlanQuotaResetOpportunityBadges,
} from "@/lib/codingPlanQuotaResetUi.js";

const FIVE_HOURS_MS = 5 * 60 * 60 * 1_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

function buildLimit(overrides: Partial<UsageQuotaLimit> = {}): UsageQuotaLimit {
  return {
    type: "TOKENS_LIMIT",
    percentage: 42,
    nextResetTime: Date.UTC(2026, 7, 7, 15, 0, 0),
    usageDetails: [],
    ...overrides,
  };
}

describe("coding plan quota reset ui state", () => {
  it("Trigger confetti only recognizes new used_at from auto-completion; manual completion does not play", () => {
    const manualDone = advanceCodingPlanQuotaResetCelebration(null, {
      sourceKey: "builtin:personal",
      completedAt: 1_000,
      automaticCompletion: false,
    });
    expect(manualDone.shouldCelebrate).toBe(false);

    const automaticDone = advanceCodingPlanQuotaResetCelebration(manualDone.state, {
      sourceKey: "builtin:personal",
      completedAt: 2_000,
      automaticCompletion: true,
    });
    expect(automaticDone.shouldCelebrate).toBe(true);
    expect(
      advanceCodingPlanQuotaResetCelebration(automaticDone.state, {
        sourceKey: "builtin:personal",
        completedAt: 2_000,
        automaticCompletion: true,
      }).shouldCelebrate,
    ).toBe(false);

    const nextAutomatic = advanceCodingPlanQuotaResetCelebration(automaticDone.state, {
      sourceKey: "builtin:personal",
      completedAt: 3_000,
      automaticCompletion: true,
    });
    expect(nextAutomatic.shouldCelebrate).toBe(true);

    const switched = advanceCodingPlanQuotaResetCelebration(nextAutomatic.state, {
      sourceKey: "team-plan:builtin:team-a",
      completedAt: 3_000,
      automaticCompletion: true,
    });
    expect(switched.shouldCelebrate).toBe(true);
    expect(switched.state).toEqual({
      sourceKey: "team-plan:builtin:team-a",
      celebratedCompletedAt: 3_000,
    });

    expect(
      advanceCodingPlanQuotaResetCelebration(switched.state, {
        sourceKey: "team-plan:builtin:team-a",
        completedAt: null,
        automaticCompletion: true,
      }).shouldCelebrate,
    ).toBe(false);
  });

  it("Create AVAILABLE only from valid server opportunities, using the earliest expiration time", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    const status: CodingPlanResetStatusSnapshot = {
      availableFiveHourResets: [
        { expireAt: now + 60_000 },
        { expireAt: now + 30_000 },
        { expireAt: now - 1 },
      ],
      availableWeekResets: [],
      latestFiveHourResetHistory: null,
      latestWeekResetHistory: null,
      hasUnreadHistory: false,
    };

    expect(applyCodingPlanQuotaResetStatus(null, status, now)).toEqual({
      status: "available",
      opportunityCount: 2,
      opportunityExpiresAt: now + 30_000,
      startedAt: null,
      completedAt: null,
      observedAt: null,
      quotaOverridePending: false,
      nextResetAt: null,
      idempotencyKey: null,
      error: null,
    });
  });

  it("Do not forge completed state on first mount when old history is not marked unread", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    expect(
      applyCodingPlanQuotaResetStatus(
        null,
        {
          availableFiveHourResets: [],
          availableWeekResets: [],
          latestFiveHourResetHistory: { usedAt: now - FIVE_HOURS_MS },
          latestWeekResetHistory: null,
          hasUnreadHistory: false,
        },
        now,
      ),
    ).toBeNull();
  });

  it("自动 unread 历史或手动 processing 对账后使用服务端 usedAt 完成", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    const usedAt = now - 1_000;
    const status: CodingPlanResetStatusSnapshot = {
      availableFiveHourResets: [],
      availableWeekResets: [],
      latestFiveHourResetHistory: { usedAt },
      latestWeekResetHistory: null,
      hasUnreadHistory: true,
    };

    const automatic = applyCodingPlanQuotaResetStatus(null, status, now);
    expect(automatic?.status).toBe("completed");
    expect(automatic?.completedAt).toBe(usedAt);
    expect(automatic?.observedAt).toBe(now);
    expect(automatic?.quotaOverridePending).toBe(true);

    const available = applyCodingPlanQuotaResetStatus(
      null,
      {
        ...status,
        latestFiveHourResetHistory: null,
        hasUnreadHistory: false,
        availableFiveHourResets: [{ expireAt: now + 30_000 }],
      },
      now,
    );
    const processing = startCodingPlanQuotaResetManualUse(available, "retry-same-key", now);
    const manual = applyCodingPlanQuotaResetStatus(
      processing,
      { ...status, hasUnreadHistory: false },
      now + 1_000,
      now,
    );
    expect(manual?.status).toBe("completed");
    expect(manual?.completedAt).toBe(usedAt);
    expect(manual?.idempotencyKey).toBeNull();
  });

  it("Use shared startedAt when observing manual completion history across entry points; repeated polling will not degrade to auto-completion", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    const usedAt = now + 1_000;
    const manualStartedAt = now - 500;
    const snapshot = {
      availableFiveHourResets: [],
      availableWeekResets: [],
      latestFiveHourResetHistory: { usedAt },
      latestWeekResetHistory: null,
      hasUnreadHistory: false,
    };

    const completed = applyCodingPlanQuotaResetStatus(null, snapshot, now, manualStartedAt);
    expect(completed?.startedAt).toBe(manualStartedAt);
    expect(resolveCodingPlanQuotaResetStatusVisible(completed, now)).toBe(false);

    const repeated = applyCodingPlanQuotaResetStatus(completed, snapshot, now + 30_000);
    expect(repeated?.startedAt).toBe(manualStartedAt);
    expect(resolveCodingPlanQuotaResetStatusVisible(repeated, now + 30_000)).toBe(false);
  });

  it("Auto-reset short prompt starts from initial observation time; repeated polling of the same usedAt will not extend it", () => {
    const usedAt = Date.UTC(2026, 7, 7, 10, 0, 0);
    const firstObservedAt = usedAt + 30_000;
    const snapshot: CodingPlanResetStatusSnapshot = {
      availableFiveHourResets: [],
      availableWeekResets: [],
      latestFiveHourResetHistory: { usedAt },
      latestWeekResetHistory: null,
      hasUnreadHistory: true,
    };

    const first = applyCodingPlanQuotaResetStatus(null, snapshot, firstObservedAt);
    expect(first?.completedAt).toBe(usedAt);
    expect(first?.observedAt).toBe(firstObservedAt);
    expect(resolveCodingPlanQuotaResetStatusVisible(first, firstObservedAt)).toBe(true);

    const repeated = applyCodingPlanQuotaResetStatus(
      first,
      { ...snapshot, hasUnreadHistory: false },
      firstObservedAt + 2_000,
    );
    expect(repeated?.observedAt).toBe(firstObservedAt);
    expect(
      resolveCodingPlanQuotaResetStatusVisible(
        repeated,
        firstObservedAt + CODING_PLAN_QUOTA_RESET_DONE_DISPLAY_MS,
      ),
    ).toBe(false);
  });

  it("Restore AVAILABLE on manual failure and retain original idempotency key for retry", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    const available = applyCodingPlanQuotaResetStatus(
      null,
      {
        availableFiveHourResets: [{ expireAt: now + 30_000 }],
        availableWeekResets: [],
        latestFiveHourResetHistory: null,
        latestWeekResetHistory: null,
        hasUnreadHistory: false,
      },
      now,
    );
    const processing = startCodingPlanQuotaResetManualUse(available, "same-key", now);
    const failed = failCodingPlanQuotaResetManualUse(processing, "code=2007");

    expect(failed).toMatchObject({
      status: "available",
      idempotencyKey: "same-key",
      error: "code=2007",
    });
    expect(
      startCodingPlanQuotaResetManualUse(failed, "must-not-replace", now + 1_000)?.idempotencyKey,
    ).toBe("same-key");
  });

  it("When completed, override 5-hour quota to 100% remaining and rewrite next reset time", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    const completed = applyCodingPlanQuotaResetStatus(
      null,
      {
        availableFiveHourResets: [],
        availableWeekResets: [],
        latestFiveHourResetHistory: { usedAt: now },
        latestWeekResetHistory: null,
        hasUnreadHistory: true,
      },
      now,
    );

    const overridden = resolveCodingPlanQuotaResetLimit(buildLimit(), completed);
    expect(overridden?.percentage).toBe(0);
    expect(overridden?.nextResetTime).toBe(now + FIVE_HOURS_MS);

    const refreshed = completeCodingPlanQuotaResetEntitlementRefresh(completed, now);
    expect(refreshed?.quotaOverridePending).toBe(false);
    expect(resolveCodingPlanQuotaResetLimit(buildLimit(), refreshed)).toEqual(buildLimit());
    expect(
      resolveCodingPlanQuotaResetLimit(buildLimit({ nextResetTime: undefined }), refreshed),
    ).toMatchObject({ percentage: 42, nextResetTime: now + FIVE_HOURS_MS });
    const repeated = applyCodingPlanQuotaResetStatus(
      refreshed,
      {
        availableFiveHourResets: [],
        availableWeekResets: [],
        latestFiveHourResetHistory: { usedAt: now },
        latestWeekResetHistory: null,
        hasUnreadHistory: false,
      },
      now + 30_000,
    );
    expect(repeated?.quotaOverridePending).toBe(false);

    expect(
      resolveCodingPlanQuotaResetLimit(
        buildLimit(),
        applyCodingPlanQuotaResetStatus(
          null,
          {
            availableFiveHourResets: [{ expireAt: now + 60_000 }],
            availableWeekResets: [],
            latestFiveHourResetHistory: null,
            latestWeekResetHistory: null,
            hasUnreadHistory: false,
          },
          now,
        ),
      ),
    ).toEqual(buildLimit());
    expect(
      resolveCodingPlanQuotaResetLimit(
        buildLimit(),
        startCodingPlanQuotaResetManualUse(
          applyCodingPlanQuotaResetStatus(
            null,
            {
              availableFiveHourResets: [{ expireAt: now + 60_000 }],
              availableWeekResets: [],
              latestFiveHourResetHistory: null,
              latestWeekResetHistory: null,
              hasUnreadHistory: false,
            },
            now,
          ),
          "key",
          now,
        ),
      ),
    ).toEqual(buildLimit());
  });

  it("Retain actual remaining percentage returned by server when incomplete", () => {
    expect(
      resolveCodingPlanQuotaResetRemainingPercentage(
        37,
        applyCodingPlanQuotaResetStatus(
          null,
          {
            availableFiveHourResets: [{ expireAt: Date.UTC(2026, 7, 7) + 60_000 }],
            availableWeekResets: [],
            latestFiveHourResetHistory: null,
            latestWeekResetHistory: null,
            hasUnreadHistory: false,
          },
          Date.UTC(2026, 7, 7),
        ),
      ),
    ).toBe(37);
  });

  it("手动重置只播放按钮烟花，不显示 processing 或 completed Tooltip", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    const available = applyCodingPlanQuotaResetStatus(
      null,
      {
        availableFiveHourResets: [{ expireAt: now + 60_000 }],
        availableWeekResets: [],
        latestFiveHourResetHistory: null,
        latestWeekResetHistory: null,
        hasUnreadHistory: false,
      },
      now,
    );
    expect(resolveCodingPlanQuotaResetStatusVisible(available, now)).toBe(false);

    const processing = startCodingPlanQuotaResetManualUse(available, "key", now);
    expect(resolveCodingPlanQuotaResetStatusVisible(processing, now + 999_999)).toBe(false);

    const completed = applyCodingPlanQuotaResetStatus(
      processing,
      {
        availableFiveHourResets: [],
        availableWeekResets: [],
        latestFiveHourResetHistory: { usedAt: now },
        latestWeekResetHistory: null,
        hasUnreadHistory: false,
      },
      now,
    );
    expect(resolveCodingPlanQuotaResetStatusVisible(completed, now)).toBe(false);
  });

  it("Collapse completed Tooltip for automatic or operational resets after the display window ends", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    const completed = applyCodingPlanQuotaResetStatus(
      null,
      {
        availableFiveHourResets: [],
        availableWeekResets: [],
        latestFiveHourResetHistory: { usedAt: now - 30_000 },
        latestWeekResetHistory: null,
        hasUnreadHistory: true,
      },
      now,
    );

    expect(resolveCodingPlanQuotaResetStatusVisible(completed, now)).toBe(true);
    expect(
      resolveCodingPlanQuotaResetStatusVisible(
        completed,
        now + CODING_PLAN_QUOTA_RESET_DONE_DISPLAY_MS - 1,
      ),
    ).toBe(true);
    expect(
      resolveCodingPlanQuotaResetStatusVisible(
        completed,
        now + CODING_PLAN_QUOTA_RESET_DONE_DISPLAY_MS,
      ),
    ).toBe(false);
    expect(resolveCodingPlanQuotaResetStatusVisible(null, now)).toBe(false);
  });

  it("Composer auto-reset synthesis phase: \"resetting\" first, then persistent \"reset\", collapses on hover, and does not enter on manual/incomplete", () => {
    const usedAt = Date.UTC(2026, 7, 7, 10, 0, 0);
    const observedAt = usedAt + 30_000;
    const snapshot: CodingPlanResetStatusSnapshot = {
      availableFiveHourResets: [],
      availableWeekResets: [],
      latestFiveHourResetHistory: { usedAt },
      latestWeekResetHistory: null,
      hasUnreadHistory: true,
    };
    const automatic = applyCodingPlanQuotaResetStatus(null, snapshot, observedAt);
    expect(automatic?.startedAt).toBeNull();
    expect(automatic?.observedAt).toBe(observedAt);

    expect(resolveCodingPlanQuotaResetAutomaticPhase(automatic, observedAt, false)).toBe(
      "processing",
    );
    expect(
      resolveCodingPlanQuotaResetAutomaticPhase(
        automatic,
        observedAt + CODING_PLAN_QUOTA_RESET_AUTOMATIC_PROCESSING_MS - 1,
        false,
      ),
    ).toBe("processing");

    expect(
      resolveCodingPlanQuotaResetAutomaticPhase(
        automatic,
        observedAt + CODING_PLAN_QUOTA_RESET_AUTOMATIC_PROCESSING_MS,
        false,
      ),
    ).toBe("completed");
    expect(
      resolveCodingPlanQuotaResetAutomaticPhase(automatic, observedAt + 3_600_000, false),
    ).toBe("completed");

    expect(resolveCodingPlanQuotaResetAutomaticPhase(automatic, observedAt, true)).toBeNull();

    const manual = applyCodingPlanQuotaResetStatus(null, snapshot, observedAt, usedAt - 500);
    expect(manual?.startedAt).toBe(usedAt - 500);
    expect(resolveCodingPlanQuotaResetAutomaticPhase(manual, observedAt, false)).toBeNull();

    const available = applyCodingPlanQuotaResetStatus(
      null,
      {
        availableFiveHourResets: [{ expireAt: observedAt + 60_000 }],
        availableWeekResets: [],
        latestFiveHourResetHistory: null,
        latestWeekResetHistory: null,
        hasUnreadHistory: false,
      },
      observedAt,
    );
    expect(resolveCodingPlanQuotaResetAutomaticPhase(available, observedAt, false)).toBeNull();
    expect(resolveCodingPlanQuotaResetAutomaticPhase(null, observedAt, false)).toBeNull();
  });

  it("Read weekly quota chances by resetType to create AVAILABLE", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    const status: CodingPlanResetStatusSnapshot = {
      availableFiveHourResets: [],
      availableWeekResets: [{ expireAt: now + 90_000 }, { expireAt: now + 45_000 }],
      latestFiveHourResetHistory: null,
      latestWeekResetHistory: null,
      hasUnreadHistory: false,
    };

    expect(applyCodingPlanQuotaResetStatus(null, status, now, null, "WEEK")).toMatchObject({
      status: "available",
      opportunityCount: 2,
      opportunityExpiresAt: now + 45_000,
    });
    expect(applyCodingPlanQuotaResetStatus(null, status, now)).toBeNull();
  });

  it("Optimistically rewrite next reset time by 7 days when weekly quota unread history completes", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    const usedAt = now - 1_000;
    const completed = applyCodingPlanQuotaResetStatus(
      null,
      {
        availableFiveHourResets: [],
        availableWeekResets: [],
        latestFiveHourResetHistory: null,
        latestWeekResetHistory: { usedAt },
        hasUnreadHistory: true,
      },
      now,
      null,
      "WEEK",
    );
    expect(completed?.status).toBe("completed");
    expect(completed?.completedAt).toBe(usedAt);
    expect(completed?.nextResetAt).toBe(usedAt + WEEK_MS);

    const overridden = resolveCodingPlanQuotaResetLimit(buildLimit(), completed);
    expect(overridden?.percentage).toBe(0);
    expect(overridden?.nextResetTime).toBe(usedAt + WEEK_MS);
  });

  it("Newly issued chances within the same used_at cycle break sticky completed state and return to AVAILABLE", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    const usedAt = now - 1_000;
    const completedSnapshot: CodingPlanResetStatusSnapshot = {
      availableFiveHourResets: [],
      availableWeekResets: [],
      latestFiveHourResetHistory: { usedAt },
      latestWeekResetHistory: null,
      hasUnreadHistory: true,
    };
    const completed = applyCodingPlanQuotaResetStatus(null, completedSnapshot, now);
    expect(completed?.status).toBe("completed");

    const regrantSnapshot: CodingPlanResetStatusSnapshot = {
      ...completedSnapshot,
      availableFiveHourResets: [{ expireAt: now + 120_000 }],
      hasUnreadHistory: false,
    };
    const revived = applyCodingPlanQuotaResetStatus(completed, regrantSnapshot, now + 60_000);
    expect(revived?.status).toBe("available");
    expect(revived?.opportunityCount).toBe(1);

    expect(
      applyCodingPlanQuotaResetStatus(null, regrantSnapshot, now + 60_000, usedAt - 500)?.status,
    ).toBe("available");

    const sticky = applyCodingPlanQuotaResetStatus(
      completed,
      { ...completedSnapshot, hasUnreadHistory: false },
      now + 60_000,
    );
    expect(sticky?.status).toBe("completed");

    const unreadWithOpportunity = applyCodingPlanQuotaResetStatus(
      null,
      {
        ...regrantSnapshot,
        hasUnreadHistory: true,
      },
      now,
    );
    expect(unreadWithOpportunity?.status).toBe("completed");

    const available = applyCodingPlanQuotaResetStatus(
      null,
      {
        ...completedSnapshot,
        latestFiveHourResetHistory: null,
        hasUnreadHistory: false,
        availableFiveHourResets: [{ expireAt: now + 60_000 }],
      },
      now,
    );
    const processing = startCodingPlanQuotaResetManualUse(available, "key", now);
    const confirmed = applyCodingPlanQuotaResetStatus(
      processing,
      regrantSnapshot,
      now + 1_000,
      now,
    );
    expect(confirmed?.status).toBe("completed");
  });

  it("Multiple chances of the same type: completed state carries remaining chances and can be redeemed again directly; cannot be redeemed once exhausted", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    const firstUsedAt = now + 1_000;
    const available = applyCodingPlanQuotaResetStatus(
      null,
      {
        availableFiveHourResets: [{ expireAt: now + 60_000 }, { expireAt: now + 120_000 }],
        availableWeekResets: [],
        latestFiveHourResetHistory: null,
        latestWeekResetHistory: null,
        hasUnreadHistory: false,
      },
      now,
    );
    expect(hasUsableCodingPlanQuotaResetOpportunity(available, now)).toBe(true);
    const processing = startCodingPlanQuotaResetManualUse(available, "first-key", now);
    expect(hasUsableCodingPlanQuotaResetOpportunity(processing, now)).toBe(false);

    const afterFirstUse: CodingPlanResetStatusSnapshot = {
      availableFiveHourResets: [{ expireAt: now + 120_000 }],
      availableWeekResets: [],
      latestFiveHourResetHistory: { usedAt: firstUsedAt },
      latestWeekResetHistory: null,
      hasUnreadHistory: true,
    };
    const completed = applyCodingPlanQuotaResetStatus(processing, afterFirstUse, now + 2_000, now);
    expect(completed).toMatchObject({
      status: "completed",
      completedAt: firstUsedAt,
      opportunityCount: 1,
      opportunityExpiresAt: now + 120_000,
      idempotencyKey: null,
    });
    expect(hasUsableCodingPlanQuotaResetOpportunity(completed, now + 2_000)).toBe(true);

    const secondProcessing = startCodingPlanQuotaResetManualUse(
      completed,
      "second-key",
      now + 3_000,
    );
    expect(secondProcessing).toMatchObject({
      status: "processing",
      startedAt: now + 3_000,
      completedAt: null,
      opportunityCount: 1,
      opportunityExpiresAt: now + 120_000,
      idempotencyKey: "second-key",
    });
    expect(failCodingPlanQuotaResetManualUse(secondProcessing, "code=2007")).toMatchObject({
      status: "available",
      opportunityCount: 1,
      opportunityExpiresAt: now + 120_000,
      idempotencyKey: "second-key",
    });

    const exhausted = applyCodingPlanQuotaResetStatus(
      secondProcessing,
      {
        ...afterFirstUse,
        availableFiveHourResets: [],
        latestFiveHourResetHistory: { usedAt: now + 4_000 },
      },
      now + 5_000,
      now + 3_000,
    );
    expect(exhausted).toMatchObject({
      status: "completed",
      completedAt: now + 4_000,
      opportunityCount: 0,
      opportunityExpiresAt: null,
    });
    expect(hasUsableCodingPlanQuotaResetOpportunity(exhausted, now + 5_000)).toBe(false);
    expect(startCodingPlanQuotaResetManualUse(exhausted, "noop-key", now + 5_000)).toBe(exhausted);

    expect(hasUsableCodingPlanQuotaResetOpportunity(completed, now + 120_000)).toBe(false);
    expect(startCodingPlanQuotaResetManualUse(completed, "expired-key", now + 120_000)).toBe(
      completed,
    );
    expect(hasUsableCodingPlanQuotaResetOpportunity(null, now)).toBe(false);

    expect(
      resolveCodingPlanQuotaResetActionCompletedAt({ entry: completed, opportunityVisible: true }),
    ).toBeNull();
    expect(
      resolveCodingPlanQuotaResetActionCompletedAt({ entry: exhausted, opportunityVisible: false }),
    ).toBe(now + 4_000);
    expect(
      resolveCodingPlanQuotaResetActionCompletedAt({ entry: null, opportunityVisible: false }),
    ).toBeNull();
  });

  it("processing only recognizes new used_at differing from pre-click baseline: stale snapshots (including uncleared unread) stay processing", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    const firstUsedAt = now - 2_000;
    const afterFirstUse: CodingPlanResetStatusSnapshot = {
      availableFiveHourResets: [{ expireAt: now + 60_000 }],
      availableWeekResets: [],
      latestFiveHourResetHistory: { usedAt: firstUsedAt },
      latestWeekResetHistory: null,
      hasUnreadHistory: true,
    };
    const completed = applyCodingPlanQuotaResetStatus(
      null,
      afterFirstUse,
      now - 1_000,
      now - 3_000,
    );
    expect(completed).toMatchObject({ status: "completed", opportunityCount: 1 });

    const processing = startCodingPlanQuotaResetManualUse(completed, "second-key", now);
    for (const hasUnreadHistory of [true, false]) {
      expect(
        applyCodingPlanQuotaResetStatus(
          processing,
          { ...afterFirstUse, hasUnreadHistory },
          now + 100,
        ),
      ).toBe(processing);
    }

    const confirmed = applyCodingPlanQuotaResetStatus(
      processing,
      {
        ...afterFirstUse,
        availableFiveHourResets: [],
        latestFiveHourResetHistory: { usedAt: now + 500 },
      },
      now + 800,
      now,
    );
    expect(confirmed).toMatchObject({
      status: "completed",
      completedAt: now + 500,
      startedAt: now,
      opportunityCount: 0,
    });
  });

  it("Merge 5-hour and weekly chance badges: sum counts, use earliest expiration for countdown, count only one side if only one is visible", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    expect(
      mergeCodingPlanQuotaResetOpportunityBadges([
        { count: 2, expiresAt: now + 60_000, visible: true },
        { count: 1, expiresAt: now + 30_000, visible: true },
      ]),
    ).toEqual({ count: 3, expiresAt: now + 30_000, visible: true });

    expect(
      mergeCodingPlanQuotaResetOpportunityBadges([
        { count: 2, expiresAt: now + 60_000, visible: true },
        { count: 1, expiresAt: now + 30_000, visible: false },
      ]),
    ).toEqual({ count: 2, expiresAt: now + 60_000, visible: true });

    expect(
      mergeCodingPlanQuotaResetOpportunityBadges([
        { count: 0, expiresAt: now + 60_000, visible: true },
        { count: 1, expiresAt: null, visible: false },
      ]),
    ).toEqual({ count: 0, expiresAt: null, visible: false });
  });

  it("Shared has_unread_history belongs only to the type with the latest used_at to avoid erroneously completing the other type", () => {
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);
    const staleFiveHourUsedAt = now - FIVE_HOURS_MS;
    const freshWeekUsedAt = now - 1_000;
    const snapshot: CodingPlanResetStatusSnapshot = {
      availableFiveHourResets: [],
      availableWeekResets: [],
      latestFiveHourResetHistory: { usedAt: staleFiveHourUsedAt },
      latestWeekResetHistory: { usedAt: freshWeekUsedAt },
      hasUnreadHistory: true,
    };

    expect(applyCodingPlanQuotaResetStatus(null, snapshot, now, null, "FIVE_HOUR")).toBeNull();

    const week = applyCodingPlanQuotaResetStatus(null, snapshot, now, null, "WEEK");
    expect(week?.status).toBe("completed");
    expect(week?.completedAt).toBe(freshWeekUsedAt);

    const tie: CodingPlanResetStatusSnapshot = {
      ...snapshot,
      latestFiveHourResetHistory: { usedAt: freshWeekUsedAt },
    };
    expect(applyCodingPlanQuotaResetStatus(null, tie, now, null, "FIVE_HOUR")?.status).toBe(
      "completed",
    );
    expect(applyCodingPlanQuotaResetStatus(null, tie, now, null, "WEEK")?.status).toBe("completed");
  });
});
