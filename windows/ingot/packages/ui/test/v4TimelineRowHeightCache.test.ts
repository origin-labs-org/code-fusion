import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROW_HEIGHT_ESTIMATE_PX,
  TimelineRowHeightCache,
} from "@/v4/timelineRowHeightCache.js";

describe("TimelineRowHeightCache", () => {
  it("未测量行回落估计Value；测量后 estimate Back真实High度（行卸载重挂保Cache）", () => {
    const cache = new TimelineRowHeightCache();
    expect(cache.estimate(1)).toBe(DEFAULT_ROW_HEIGHT_ESTIMATE_PX);
    expect(cache.estimate(1, 100)).toBe(100);

    cache.set(1, 237);
    expect(cache.estimate(1)).toBe(237);
    expect(cache.get(1)).toBe(237);
    expect(cache.estimate(2)).toBe(DEFAULT_ROW_HEIGHT_ESTIMATE_PX);
  });

  it("rowId Unknown（越Boundary索引）回落估计Value", () => {
    const cache = new TimelineRowHeightCache();
    expect(cache.estimate(undefined)).toBe(DEFAULT_ROW_HEIGHT_ESTIMATE_PX);
    expect(cache.estimate(undefined, 48)).toBe(48);
  });

  it("重复Write以最New测量为准（Streaming行持续LongHigh）", () => {
    const cache = new TimelineRowHeightCache();
    cache.set(7, 72);
    cache.set(7, 340);
    expect(cache.estimate(7)).toBe(340);
    expect(cache.size).toBe(1);
  });

  it("HLP01：以稳定 turnId Cache，补到更早 header 后仍复用测High", () => {
    const cache = new TimelineRowHeightCache();
    cache.set("turn-long", 480);
    expect(cache.estimate("turn-long")).toBe(480);
  });

  it("Deny无效High度（0/负Count/NaN 不覆盖已有测量）", () => {
    const cache = new TimelineRowHeightCache();
    cache.set(3, 120);
    cache.set(3, 0);
    cache.set(3, -5);
    cache.set(3, Number.NaN);
    expect(cache.estimate(3)).toBe(120);
  });

  it("超上限按Write序淘汰最Old行；重复WriteRefresh淘汰顺序", () => {
    const cache = new TimelineRowHeightCache(3);
    cache.set(1, 10);
    cache.set(2, 20);
    cache.set(3, 30);
    cache.set(1, 11);
    cache.set(4, 40);
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(1)).toBe(11);
    expect(cache.get(3)).toBe(30);
    expect(cache.get(4)).toBe(40);
    expect(cache.size).toBe(3);
  });

  it("clear 全量Reset（Session切换防 rowId 串Number）", () => {
    const cache = new TimelineRowHeightCache();
    cache.set(1, 100);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.estimate(1)).toBe(DEFAULT_ROW_HEIGHT_ESTIMATE_PX);
  });
});
