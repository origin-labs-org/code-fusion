// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStartPlanQuotaReminderStore } from "@/v4/startPlanQuotaReminderStore.js";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("Start Plan actual display records", () => {
  it("Register only on display; keep current instance, do not duplicate across other tasks/restarts, and hide current instance after closing", () => {
    const store = createStartPlanQuotaReminderStore({
      storage: () => localStorage,
    });
    const owner = {};
    expect(store.isHidden("bucket-cycle", owner, 1000)).toBe(false);
    store.markShown("bucket-cycle", 3000, owner, 1000);
    expect(store.isHidden("bucket-cycle", owner, 1000)).toBe(false);
    expect(store.isHidden("bucket-cycle", {}, 1000)).toBe(true);
    store.markShown("bucket-cycle", 3000, owner, 1000);
    expect(store.isHidden("bucket-cycle", owner, 1000)).toBe(false);
    const restarted = createStartPlanQuotaReminderStore({
      storage: () => localStorage,
    });
    expect(restarted.isHidden("bucket-cycle", {}, 1000)).toBe(true);
    expect(restarted.isHidden("new-cycle", {}, 1000)).toBe(false);
    store.dismiss("bucket-cycle");
    expect(store.isHidden("bucket-cycle", owner, 1000)).toBe(true);
  });
  it("Another instance cannot take over displayed buckets; clean up expired records without deleting other business data", () => {
    const store = createStartPlanQuotaReminderStore({
      storage: () => localStorage,
    });
    const first = {};
    store.markShown("a", 2000, first, 1000);
    store.markShown("a", 2000, {}, 1000);
    expect(store.isHidden("a", first, 1000)).toBe(false);
    localStorage.setItem("unrelated", "keep");
    store.markShown("b", 3000, {}, 2001);
    expect(localStorage.length).toBe(2);
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });
  it("Deduplicate in memory when storage is disabled, without blocking the UI", () => {
    const store = createStartPlanQuotaReminderStore({
      storage: () => {
        throw new Error("denied");
      },
    });
    expect(() => store.markShown("a", 2000, {}, 1000)).not.toThrow();
    expect(store.isHidden("a", {}, 1000)).toBe(true);
  });
});

it.each([900, 2100, 2200])("设备时间 %i 不影响同周期展示、关闭和重启去重", (deviceNow) => {
  vi.spyOn(Date, "now").mockReturnValue(deviceNow);
  const store = createStartPlanQuotaReminderStore({ storage: () => localStorage });
  const owner = {};
  const serverNow = 1900;
  store.markShown("clock-cycle", 2000, owner, serverNow);
  expect(localStorage.length).toBe(1);
  expect(store.isHidden("clock-cycle", owner, serverNow)).toBe(false);
  vi.mocked(Date.now).mockReturnValue(10000);
  store.dismiss("clock-cycle");
  expect(store.isHidden("clock-cycle", owner, serverNow)).toBe(true);
  expect(store.isHidden("clock-cycle", {}, serverNow)).toBe(true);
  const restarted = createStartPlanQuotaReminderStore({ storage: () => localStorage });
  expect(restarted.isHidden("clock-cycle", {}, serverNow)).toBe(true);
  expect(restarted.isHidden("new-cycle", {}, 2100)).toBe(false);
  restarted.markShown("new-cycle", 3000, owner, 2100);
  expect(restarted.isHidden("new-cycle", {}, 2100)).toBe(true);
});
