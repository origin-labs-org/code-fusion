import { describe, expect, it } from "vitest";
import { buildCsvTableText } from "@/components/ai-elements/markdown-table.js";

describe("buildCsvTableText", () => {
  it("Add UTF-8 BOM to Chinese CSV to prevent Excel from misinterpreting local code page", () => {
    const csv = buildCsvTableText([
      ["姓名", "城市"],
      ["张三", "北京"],
    ]);

    expect(csv).toBe("\uFEFF姓名,城市\r\n张三,北京");
  });

  it("添加 BOM 时保留 CSV 转义与公式注入防护", () => {
    expect(
      buildCsvTableText([
        ["名称", "值"],
        ["示例", '=HYPERLINK("https://example.com","打开")'],
      ]),
    ).toBe(\'\uFEFFName,Value\r\nExample,\"\'=HYPERLINK(""https://example.com\"\",""Open\"\")\"\');
  });
});
