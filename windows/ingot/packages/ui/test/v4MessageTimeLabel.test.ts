import { describe, expect, it } from "vitest";
import type { IntlInstance } from "@/i18n/IntlProvider.js";
import { formatMessageTimeLabel } from "@/v4/messageTimeLabel.js";

function createIntl(yesterdayLabel: string): IntlInstance {
  return {
    formatMessage({ id }, values) {
      if (id === "chat.message.time.yesterday") {
        return `${yesterdayLabel} ${values?.time ?? ""}`.trim();
      }
      return id;
    },
  };
}

function formatExpected(
  locale: string,
  timestamp: number,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(timestamp));
}

describe("formatMessageTimeLabel", () => {
  const now = new Date(2026, 6, 13, 12, 0).getTime();
  const zhIntl = createIntl("昨天");
  const enIntl = createIntl("Yesterday");

  it("当天只ShowLocal时分", () => {
    const timestamp = new Date(2026, 6, 13, 7, 15).getTime();

    expect(formatMessageTimeLabel(timestamp, "zh-CN", zhIntl, now)).toBe(
      formatExpected("zh-CN", timestamp, { hour: "2-digit", minute: "2-digit" }),
    );
  });

  it.each([
    ["zh-CN", zhIntl, "昨天"],
    ["en-US", enIntl, "Yesterday"],
  ] as const)("%s 为昨天的Messages加Local化Prefix", (locale, intl, prefix) => {
    const timestamp = new Date(2026, 6, 12, 7, 15).getTime();
    const time = formatExpected(locale, timestamp, { hour: "2-digit", minute: "2-digit" });

    expect(formatMessageTimeLabel(timestamp, locale, intl, now)).toBe(`${prefix} ${time}`);
  });

  it("当年更早的MessagesShow月日and时分", () => {
    const timestamp = new Date(2026, 3, 10, 7, 15).getTime();

    expect(formatMessageTimeLabel(timestamp, "zh-CN", zhIntl, now)).toBe(
      formatExpected("zh-CN", timestamp, {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  });

  it("跨年MessagesShow年月日and时分", () => {
    const timestamp = new Date(2025, 11, 31, 7, 15).getTime();

    expect(formatMessageTimeLabel(timestamp, "en-US", enIntl, now)).toBe(
      formatExpected("en-US", timestamp, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("无效时间戳 %s 不展示", (timestamp) => {
    expect(formatMessageTimeLabel(timestamp, "zh-CN", zhIntl, now)).toBeNull();
  });
});
