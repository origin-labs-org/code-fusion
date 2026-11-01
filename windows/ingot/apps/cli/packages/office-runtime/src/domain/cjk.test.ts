import { describe, expect, it } from "vitest";
import { normalizeCjkCompat } from "#office/domain/cjk.ts";

describe("normalizeCjkCompat", () => {
  it("maps radicals that PDF producers emit for ideographs back to the ideographs", () => {
    expect(normalizeCjkCompat("PingFang: Chinese typography, Heaven and Earth, Hiragino Sans")).toBe(
      "PingFang: Chinese typesetting, heaven and earth dark and yellow, Hiragino Sans",
    );
  });

  it("covers every Kangxi radical and the supplement entries with an equivalent ideograph", () => {
    for (let code = 0x2f00; code <= 0x2fd5; code++) {
      const out = normalizeCjkCompat(String.fromCodePoint(code));
      expect(out.codePointAt(0)).toBeGreaterThanOrEqual(0x3400);
    }
    expect(normalizeCjkCompat("⺟⻳")).toBe("母龟");
  });

  it("keeps full-width punctuation, Latin text and the UTF-16 length", () => {
    const text = "(Full-width): \"Quotation marks\", ＡＢＣ abc 123.";
    expect(normalizeCjkCompat(text)).toBe(text);
    const mixed = "a⽂b⻩c";
    expect(normalizeCjkCompat(mixed)).toHaveLength(mixed.length);
  });
});
