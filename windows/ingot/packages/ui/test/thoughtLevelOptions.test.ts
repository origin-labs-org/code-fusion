import { describe, expect, it } from "vitest";
import type { CfConfigOption } from "@origin-ai/cf-shared";
import {
  getNextThoughtLevelValue,
  getThoughtLevelLabel,
  isNoThoughtLevel,
} from "@/chat-input-toolbar/thoughtLevelOptions.js";
import zhCN from "@/i18n/locales/zh-CN.js";
import enUS from "@/i18n/locales/en-US.js";

const option: CfConfigOption = {
  id: "thought_level",
  category: "thought_level",
  type: "select",
  currentValue: "",
};
const expectedLabels = [
  [["disabled", "false", "no", "none", "nothink", "no-think", "no_think", "off"], "关闭", "Off"],
  [["enable", "enabled", "on", "true"], "开启", "On"],
  [["minimal"], "极Low", "Minimal"],
  [["low"], "低", "Low"],
  [["medium"], "中", "Medium"],
  [["high"], "高", "High"],
  [["xhigh", "extra-high", "extra_high"], "Extra high", "Extra high"],
  [["max"], "Highest", "最高"],
  [["ultra"], "极致", "Ultra"],
] as const;

describe.each([
  ["zh-CN", zhCN, 1],
  ["en-US", enUS, 2],
] as const)("Thinking档位 %s", (_locale, messages, column) => {
  const intl = { formatMessage: ({ id }: { id: string }) => messages[id] ?? id };
  for (const row of expectedLabels) {
    it.each(row[0])("%s 使用About定Copy且不改RawValue", (value) => {
      const entry = Object.freeze({ value: ` ${value.toUpperCase()} `, name: "RawName" });
      expect(getThoughtLevelLabel(intl, "glm", option, entry)).toBe(row[column]);
      expect(entry.value).toBe(` ${value.toUpperCase()} `);
    });
  }
  it.each([
    "light",
    "shallow",
    "balanced",
    "default",
    "normal",
    "standard",
    "deep",
    "maximum",
    "very-high",
    "very_high",
    "custom",
    "constructor",
    "__proto__",
  ])("%s RetainSourceName", (value) => {
    expect(getThoughtLevelLabel(intl, "glm", option, { value, name: `Source ${value}` })).toBe(
      `Source ${value}`,
    );
  });
});

describe("Thinking档位Configuration顺序", () => {
  const values = [
    "custom",
    "high",
    "minimal",
    "off",
    "low",
    "max",
    "ultra",
    "extra-high",
    "extra_high",
  ];
  const options = values.map((value) => ({ value, name: value }));
  it.each(values)("从 %s 按Configuration顺序循环", (currentValue) => {
    expect(getNextThoughtLevelValue({ ...option, currentValue, options })).toBe(
      values[(values.indexOf(currentValue) + 1) % values.length],
    );
    expect(options.map((entry) => entry.value)).toEqual(values);
  });
  it.each(["", "missing"])("%s 从Configuration首项Start", (currentValue) => {
    expect(getNextThoughtLevelValue({ ...option, currentValue, options })).toBe("custom");
  });
  it("零档and单档不循环", () => {
    expect(getNextThoughtLevelValue({ ...option, options: [] })).toBeNull();
    expect(getNextThoughtLevelValue({ ...option, options: options.slice(0, 1) })).toBeNull();
  });
  it("仅Close类 value Yes零强度，不从SourceName猜测", () => {
    expect(isNoThoughtLevel({ value: " NOTHINK ", name: "自定义Name" })).toBe(true);
    expect(isNoThoughtLevel({ value: "custom", name: "off" })).toBe(false);
    expect(isNoThoughtLevel({ value: "minimal", name: "none" })).toBe(false);
  });
});
