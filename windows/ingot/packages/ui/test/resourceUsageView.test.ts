import { describe, expect, it } from "vitest";
import type { ResourceUsageProcess } from "@origin-ai/cf-shared";
import {
  formatBytes,
  formatPercent,
  groupResourceUsage,
} from "@/resource-manager/resourceUsageView.js";

function process(
  pid: number,
  category: ResourceUsageProcess["category"],
  cpuPercent: number,
  memoryBytes: number,
  sampled = true,
): ResourceUsageProcess {
  return {
    pid,
    name: `p${pid}`,
    category,
    groupKey: "g",
    groupLabel: "g",
    cpuPercent,
    memoryBytes,
    sampled,
  };
}

describe("groupResourceUsage", () => {
  it("Fixed three-group order, sorted descending by CPU/Memory within groups, subtotals and unsampled markers correct", () => {
    const groups = groupResourceUsage([
      process(3, "community-plugin", 1, 10),
      process(1, "base", 2, 100),
      process(2, "base", 5, 50),
      process(4, "base", 0, 0, false),
    ]);
    expect(groups.map((group) => group.category)).toEqual([
      "base",
      "builtin-plugin",
      "community-plugin",
    ]);
    expect(groups[0]).toMatchObject({
      processCount: 3,
      cpuPercent: 7,
      memoryBytes: 150,
      hasUnsampled: true,
    });
    expect(groups[0]?.processes.map((item) => item.pid)).toEqual([2, 1, 4]);
    expect(groups[1]).toMatchObject({
      processCount: 0,
      cpuPercent: 0,
      memoryBytes: 0,
      hasUnsampled: false,
    });
    expect(groups[2]?.processCount).toBe(1);
  });
});

describe("formatters", () => {
  it("Convert bytes using base-1024 and control decimal places", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
    expect(formatBytes(2.25 * 1024 ** 3)).toBe("2.3 GB");
  });
  it("百分比保留一位小数", () => {
    expect(formatPercent(12.345)).toBe("12.3%");
    expect(formatPercent(Number.NaN)).toBe("0.0%");
  });
});
