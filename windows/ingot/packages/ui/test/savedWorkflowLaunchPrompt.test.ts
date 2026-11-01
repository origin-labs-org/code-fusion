import { describe, expect, it } from "vitest";
import {
  buildSavedWorkflowCreatePrompt,
  buildSavedWorkflowPromotePrompt,
  buildSavedWorkflowRevisePrompt,
} from "@/settings/saved-workflows/savedWorkflowLaunchPrompt.js";

describe("revise / create prompts", () => {
  it("修订Copy带名Character与路径，且以冒Number结尾等User接着写", () => {
    expect(
      buildSavedWorkflowRevisePrompt({
        name: "x",
        path: "/repo/.cf/workflows/x.dwf.ts",
        locale: "zh-CN",
      }),
    ).toBe("Please revise saved workflow \"x\"（/repo/.cf/workflows/x.dwf.ts）：");
    expect(buildSavedWorkflowRevisePrompt({ name: "x", path: "/p", locale: "en-US" })).toBe(
      'Please revise the saved workflow "x" (/p): ',
    );
  });

  it("Global tier修订Append「保持 scope: global」；Project档不加", () => {
    const zh = buildSavedWorkflowRevisePrompt({
      name: "x",
      path: "/p",
      locale: "zh-CN",
      scope: "global",
    });
    expect(zh).toContain('它是全局工作流，保存时保持 scope: "global"。');
    const en = buildSavedWorkflowRevisePrompt({
      name: "x",
      path: "/p",
      locale: "en-US",
      scope: "global",
    });
    expect(en).toContain('keep scope: "global" when saving');
    expect(
      buildSavedWorkflowRevisePrompt({ name: "x", path: "/p", locale: "zh-CN", scope: "project" }),
    ).toBe(buildSavedWorkflowRevisePrompt({ name: "x", path: "/p", locale: "zh-CN" }));
  });

  it("创建Copy双语", () => {
    expect(buildSavedWorkflowCreatePrompt("zh-CN")).toContain("保存到本项目");
    expect(buildSavedWorkflowCreatePrompt("en-US")).toContain("save it to this project");
  });

  it("Global tier创建Copy说Save为全局Workflow；Project档缺省不变", () => {
    expect(buildSavedWorkflowCreatePrompt("zh-CN", "global")).toContain(
      '保存为全局工作流（scope: "global"）',
    );
    expect(buildSavedWorkflowCreatePrompt("en-US", "global")).toContain(
      'save it as a global workflow (scope: "global")',
    );
    expect(buildSavedWorkflowCreatePrompt("zh-CN", "project")).toBe(
      buildSavedWorkflowCreatePrompt("zh-CN"),
    );
  });
});

describe("promote prompt", () => {
  const input = { name: "release-check", path: "/repo/.cf/workflows/release-check.dwf.ts" };

  it("Chinese：带名Character与路径、要求 scope global、AllowRename、不动Original text件、可Deny", () => {
    const zh = buildSavedWorkflowPromotePrompt({ ...input, locale: "zh-CN" });
    expect(zh).toContain("「release-check」（/repo/.cf/workflows/release-check.dwf.ts）");
    expect(zh).toContain('scope: "global"');
    expect(zh).toContain("`args`");
    expect(zh).toContain("名Character可以沿用，也可以取One个更贴切的名Character");
    expect(zh).toContain("不要改动原来的ProjectWorkflowFile");
    expect(zh).toContain("Description原因并停下，不要Save");
    expect(zh).not.toContain("export default");
  });

  it("English：同One清单", () => {
    const en = buildSavedWorkflowPromotePrompt({ ...input, locale: "en-US" });
    expect(en).toContain('"release-check" (/repo/.cf/workflows/release-check.dwf.ts)');
    expect(en).toContain('scope: "global"');
    expect(en).toContain("Keep the name or pick a better one");
    expect(en).toContain("Do not modify the original project workflow file");
    expect(en).toContain("stop without saving");
  });
});
