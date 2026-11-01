import { describe, expect, it } from "vitest";
import { normalizeConversationShareMarkdown } from "@/v4/conversationShareMarkdown.js";

describe("normalizeConversationShareMarkdown", () => {
  it("removes local citation paths while retaining a uniquely matched public artifact name", () => {
    const markdown =
      '结论见 ::cf-file-citation{path="/Users/demo/report.pdf" purpose="output"}。';
    const result = normalizeConversationShareMarkdown(
      markdown,
      new Map([["share-artifact-1", "report.pdf"]]),
    );

    expect(result).toBe("See conclusion in report.pdf.");
  });

  it("does not rewrite citation-looking text inside a fenced code block", () => {
    const markdown = ["```md", '::cf-file-citation{path="example.pdf"}', "```"].join("\n");

    expect(normalizeConversationShareMarkdown(markdown)).toBe(markdown);
  });

  describe("远程图片降级", () => {
    it("Degrade http/https images to plain links", () => {
      expect(normalizeConversationShareMarkdown("![图](https://evil.example/x.png)")).toBe(
        "[图](https://evil.example/x.png)",
      );
      expect(normalizeConversationShareMarkdown("![图](http://evil.example/x.png)")).toBe(
        "[图](http://evil.example/x.png)",
      );
    });

    it("Cover titles, angle bracket syntax, and protocol-relative URLs", () => {
      expect(normalizeConversationShareMarkdown('![图](https://evil.example/x.png "标题")')).toBe(
        '[图](https://evil.example/x.png "标题")',
      );
      expect(normalizeConversationShareMarkdown("![图](<https://evil.example/a b.png>)")).toBe(
        "[图](<https://evil.example/a b.png>)",
      );
      expect(normalizeConversationShareMarkdown("![图](//evil.example/x.png)")).toBe(
        "[图](//evil.example/x.png)",
      );
    });

    it("保留 data: 与相对路径图片", () => {
      const dataImage = "![本地](data:image/png;base64,AAAA)";
      expect(normalizeConversationShareMarkdown(dataImage)).toBe(dataImage);
      const relative = "![本地](./assets/x.png)";
      expect(normalizeConversationShareMarkdown(relative)).toBe(relative);
    });

    it("不改写代码围栏内的远程图片语法", () => {
      const markdown = ["```md", "![图](https://evil.example/x.png)", "```"].join("\n");
      expect(normalizeConversationShareMarkdown(markdown)).toBe(markdown);
    });

    it("Degrade all multiple remote images within the same paragraph", () => {
      expect(
        normalizeConversationShareMarkdown(
          "Before ![a](https://a.example/1.png) Middle ![b](https://b.example/2.png) After",
        ),
      ).toBe("Before [a](https://a.example/1.png) Middle [b](https://b.example/2.png) After");
    });

    it("Take effect simultaneously with citation stripping", () => {
      const result = normalizeConversationShareMarkdown(
        '![图](https://evil.example/x.png) 见 ::cf-file-citation{path="/Users/demo/report.pdf"}。',
        new Map([["share-artifact-1", "report.pdf"]]),
      );
      expect(result).toBe("[图](https://evil.example/x.png) 见 report.pdf。");
    });
  });
});
