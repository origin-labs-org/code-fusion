import type { IBroadcastService } from "@origin-ai/cf-services";
import { beforeEach, describe, expect, it } from "vitest";
import { createCfStore } from "@/store/index.js";

const localStorageState = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageState.get(key) ?? null,
    setItem: (key: string, value: string) => {
      localStorageState.set(key, value);
    },
    removeItem: (key: string) => {
      localStorageState.delete(key);
    },
    clear: () => {
      localStorageState.clear();
    },
  },
});

Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    documentElement: {
      classList: {
        contains: () => false,
        toggle: () => {},
      },
    },
  },
});

const mockBroadcastService: IBroadcastService = {
  send: async () => {},
  onMessage: () => ({ dispose: () => {} }),
};

describe("createCfStore global state", () => {
  beforeEach(() => {
    localStorageState.clear();
  });

  it("默认不处于 OAuth 启动恢复中", () => {
    const store = createCfStore(mockBroadcastService);

    expect(store.getState().isRestoringOAuthSession).toBe(false);
  });

  it("Supports initializing OAuth recovery state to pending before initial render", () => {
    const store = createCfStore(mockBroadcastService, {
      initialIsRestoringOAuthSession: true,
    });

    expect(store.getState().isRestoringOAuthSession).toBe(true);
  });

  it("Supports requesting unified login entry to directly enter the specified provider\'s login flow", () => {
    const store = createCfStore(mockBroadcastService);

    const requestId = store.getState().requestLoginEntry("zai");

    const request = store.getState().loginEntryRequest;
    expect(request?.providerId).toBe("zai");
    expect(requestId).toBe(request?.id);
    expect(store.getState().loginEntryAttempt).toEqual({
      id: requestId,
      providerId: "zai",
      purpose: undefined,
      status: "requested",
    });

    store.getState().markLoginEntryAttemptStatus(requestId, "waiting");
    expect(store.getState().loginEntryAttempt?.status).toBe("waiting");

    store.getState().clearLoginEntryRequest(request?.id);

    expect(store.getState().loginEntryRequest).toBe(null);
  });

  it("Canceled login attempts are not falsely updated by stale or subsequent new requests", () => {
    const store = createCfStore(mockBroadcastService);
    const cancelledId = store.getState().requestLoginEntry("zai");
    store.getState().markLoginEntryAttemptStatus(cancelledId, "cancelled");
    const currentId = store.getState().requestLoginEntry("bigmodel");

    store.getState().markLoginEntryAttemptStatus(cancelledId, "succeeded");

    expect(store.getState().loginEntryAttempt).toMatchObject({
      id: currentId,
      providerId: "bigmodel",
      status: "requested",
    });
  });

  it("Advance auth session sequence number only when user transitions from logged-out to logged-in", () => {
    const store = createCfStore(mockBroadcastService);
    const user = { id: "user-1", username: "tester", displayName: "Tester" };

    store.getState().setUser(user);
    expect(store.getState().authSessionSeq).toBe(1);

    store.getState().setUser({ ...user, displayName: "Tester Updated" });
    expect(store.getState().authSessionSeq).toBe(1);

    store.getState().setUser(null);
    store.getState().setUser(user);
    expect(store.getState().authSessionSeq).toBe(2);
  });

  it("Retain initial auth session for the same autocomplete history and reject write-backs from stale sessions", () => {
    const store = createCfStore(mockBroadcastService);
    const user = { id: "user-1", username: "tester", displayName: "Tester" };
    const firstCompletedAt = Date.now() - 10_000;
    const secondCompletedAt = Date.now() - 1_000;

    store.getState().setUser(user);
    store.getState().setCodingPlanQuotaResetUiEntry(
      "composer:test",
      "WEEK",
      {
        status: "completed",
        opportunityCount: 0,
        opportunityExpiresAt: null,
        startedAt: null,
        completedAt: firstCompletedAt,
        observedAt: firstCompletedAt + 100,
        quotaOverridePending: false,
        nextResetAt: null,
        idempotencyKey: null,
        error: null,
      },
      1,
    );

    store.getState().setUser(null);
    store.getState().setUser(user);
    store.getState().setCodingPlanQuotaResetUiEntry(
      "composer:test",
      "WEEK",
      {
        status: "completed",
        opportunityCount: 0,
        opportunityExpiresAt: null,
        startedAt: null,
        completedAt: firstCompletedAt,
        observedAt: null,
        quotaOverridePending: false,
        nextResetAt: null,
        idempotencyKey: null,
        error: null,
      },
      2,
    );

    expect(
      store.getState().codingPlanQuotaResetAutomaticObservationsBySource[
        "composer:test"
      ]?.week,
    ).toEqual({ completedAt: firstCompletedAt, authSessionSeq: 1 });

    store.getState().setCodingPlanQuotaResetUiEntry(
      "composer:test",
      "WEEK",
      {
        status: "completed",
        opportunityCount: 0,
        opportunityExpiresAt: null,
        startedAt: null,
        completedAt: secondCompletedAt,
        observedAt: secondCompletedAt + 100,
        quotaOverridePending: true,
        nextResetAt: null,
        idempotencyKey: null,
        error: null,
      },
      1,
    );
    expect(
      store.getState().codingPlanQuotaResetUiBySource["composer:test"]?.week
        ?.completedAt,
    ).toBe(firstCompletedAt);
  });

  it("Record the platform of the last successful OAuth", () => {
    const store = createCfStore(mockBroadcastService);

    store.getState().markOAuthSuccess("zai");

    expect(store.getState().oauthSuccessSeq).toBe(1);
    expect(store.getState().lastOAuthSuccessProvider).toBe("zai");
  });

  it("Performance mode is disabled by default, and user choice is persisted", () => {
    const store = createCfStore(mockBroadcastService);

    expect(store.getState().performanceMode).toBe(false);

    store.getState().setPerformanceMode(true);

    expect(store.getState().performanceMode).toBe(true);
    expect(localStorageState.get("cf-performance-mode")).toBe("true");
    expect(
      createCfStore(mockBroadcastService).getState().performanceMode,
    ).toBe(true);
  });
});
