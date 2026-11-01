import { describe, expect, it } from "vitest";
import { buildAssistantPreviewCards } from "@/lib/assistantPreviewCards.js";

const path = "/workspace/visualizations/calendar.html";
const directive = `::visualize${JSON.stringify({ path })}`;

describe("visualize 源文件的预览卡片", () => {
  it.each([directive, `::visualize{path="${path}"}`, `visualize${JSON.stringify({ path })}`])(
    "有效引用不再生成 HTML 卡片：%s",
    (reference) => {
      expect(
        buildAssistantPreviewCards(`${reference}\n[Calendar](${path})`, "/workspace", {
          changedFilePaths: [path],
        }),
      ).toEqual([]);
    },
  );

  it("Mixed modifications hide only referenced full paths, preserving HTML and other files with the same name", () => {
    const cards = buildAssistantPreviewCards(
      `${directive}\n[Calendar](${path})\n[普通Web](/workspace/calendar.html)\nREADME.md report.pdf`,
      "/workspace",
      { changedFilePaths: [path, "/workspace/calendar.html", "/workspace/README.md"] },
    );
    expect(cards.map((card) => card.title)).toEqual(["report.pdf", "README.md", "calendar.html"]);
    expect(cards.some((card) => card.type === "website" && card.filePath === path)).toBe(false);
  });

  it.each([
    `\`${directive}\``,
    `\`\`\`text\n${directive}\n\`\`\``,
    `::visualize{"path":"${path}"`,
    `::visualize{"path":"${path}","mode":"fullscreen"}`,
  ])("Example, unclosed, or invalid references do not hide regular HTML: %s", (reference) => {
    expect(
      buildAssistantPreviewCards(`${reference}\n[Calendar](${path})`, "/workspace", {
        changedFilePaths: [path],
      }).map((card) => card.title),
    ).toEqual(["calendar.html"]);
  });

  it("Windows references and change records are normalized for separators before matching", () => {
    const windowsPath = String.raw`C:\workspace\visualizations\calendar.html`;
    expect(
      buildAssistantPreviewCards(
        `::visualize${JSON.stringify({ path: windowsPath })}\nC:/workspace/visualizations/calendar.html`,
        "C:/workspace",
        { changedFilePaths: ["C:/workspace/visualizations/calendar.html"] },
      ),
    ).toEqual([]);
  });
});
