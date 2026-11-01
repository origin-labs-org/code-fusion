import { describe, expect, it } from "vitest";
import { summarizeLongTaskAttribution } from "../src/main/longTaskAttributionSummary.js";

describe("summarizeLongTaskAttribution", () => {
  it("Extract the longest attribution as top and calculate its proportion", () => {
    const snapshots = JSON.stringify([
      { duration: 40, invokerType: "event-listener" },
      { duration: 120, invokerType: "user-callback" },
      { duration: 10, invokerType: "user-callback" },
    ]);
    const result = summarizeLongTaskAttribution(snapshots, 200);
    expect(result).toEqual({
      loaf_script_count: 3,
      loaf_top_duration_ms: 120,
      loaf_top_invoker_type: "user-callback",
      loaf_top_share_pct: 60,
    });
  });

  it("snapshots 为空字符串时返回 null", () => {
    expect(summarizeLongTaskAttribution("", 200)).toBeNull();
  });

  it("Return null when snapshots is \'[]\'", () => {
    expect(summarizeLongTaskAttribution("[]", 200)).toBeNull();
  });

  it("snapshots 非法 JSON 时返回 null", () => {
    expect(summarizeLongTaskAttribution("{not valid json", 200)).toBeNull();
  });

  it("snapshots 为 undefined 时返回 null", () => {
    expect(summarizeLongTaskAttribution(undefined, 200)).toBeNull();
  });

  it("invokerType 缺失时归一化为 script(rAF 来源)", () => {
    const snapshots = JSON.stringify([{ duration: 50, containerType: "iframe" }]);
    const result = summarizeLongTaskAttribution(snapshots, 100);
    expect(result?.loaf_top_invoker_type).toBe("script");
  });

  it("invokerType 为非法枚举值时归一化为 unknown", () => {
    const snapshots = JSON.stringify([{ duration: 50, invokerType: "weird-value" }]);
    const result = summarizeLongTaskAttribution(snapshots, 100);
    expect(result?.loaf_top_invoker_type).toBe("unknown");
  });

  it("Record share as 0 when totalDurationMs is 0/negative/non-numeric, other fields remain normal", () => {
    const snapshots = JSON.stringify([{ duration: 50, invokerType: "user-callback" }]);
    for (const total of [0, -10, Number.NaN, "not-a-number", undefined]) {
      const result = summarizeLongTaskAttribution(snapshots, total);
      expect(result).not.toBeNull();
      expect(result?.loaf_top_share_pct).toBe(0);
      expect(result?.loaf_top_duration_ms).toBe(50);
    }
  });
});
