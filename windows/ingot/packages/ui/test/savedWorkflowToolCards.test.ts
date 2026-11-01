// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { resolveToolCallRenderer } from "@/ToolCallBlocks/resolveRenderer.js";
import { CreateWorkflowToolCallBlock } from "@/ToolCallBlocks/renderers/create-workflow.js";
import {
  formatWorkflowArgValue,
  readWorkflowName,
  readWorkflowSaved,
  readWorkflowScript,
} from "@/ToolCallBlocks/renderers/createWorkflowInput.js";
import {
  ListSavedWorkflowsToolCallBlock,
  readListSavedWorkflowsResult,
} from "@/ToolCallBlocks/renderers/list-saved-workflows.js";
import { SaveWorkflowToolCallBlock } from "@/ToolCallBlocks/renderers/save-workflow.js";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";

const SCRIPT = 'const r = await agent("a").ask<string>("检查");';
const SAVED_PATH = "/workspace/.cf/workflows/release-check.dwf.ts";

const LIST_RESULT = {
  workflows: [
    {
      name: "release-check",
      description: "Pre-release checks: lint, tests, changelog",
      whenToUse: "用户说要发版时",
      args: { target: { type: "string", required: true }, skipTests: { type: "boolean" } },
      scope: "project",
      path: SAVED_PATH,
    },
    {
      name: "translate-docs",
      description: "批量翻译文档目录",
      scope: "project",
      path: "/workspace/.cf/workflows/translate-docs.dwf.ts",
    },
  ],
  invalid: [{ path: "/workspace/.cf/workflows/broken.dwf.ts", reason: "yaml_invalid" }],
};

function buildContext(
  toolCall: Record<string, unknown>,
  overrides: Partial<ToolCallBlockRenderContext> = {},
): ToolCallBlockRenderContext {
  return {
    toolCallNode: { toolCall, childToolCalls: [] },
    workspacePath: "/workspace",
    displayModel: {
      inlinePreview: { type: "none" },
      planResult: null,
      viewerSource: null,
      viewerLabelId: "codeViewer.viewCode",
      showSummaryFileLink: false,
      showInput: false,
      showOutput: false,
      showKind: false,
    },
    viewerSource: null,
    rawFileSummaries: [],
    isRunning: false,
    statusLabel: "",
    childToolList: null,
    showIcon: true,
    forceOpen: true,
    canToggle: false,
    ...overrides,
  } as ToolCallBlockRenderContext;
}

function renderCard(
  component: (context: ToolCallBlockRenderContext) => unknown,
  context: ToolCallBlockRenderContext,
  locale: "en-US" | "zh-CN" = "en-US",
) {
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: locale },
      createElement(component as never, context),
    ),
  );
}

function buildSaveToolCall(input: Record<string, unknown> = {}) {
  return {
    toolId: "tool-save-1",
    toolName: "SaveWorkflow",
    kind: "SaveWorkflow",
    title: "SaveWorkflow",
    status: "completed",
    input: {
      name: "release-check",
      description: "Pre-release checks: lint, tests, changelog",
      whenToUse: "用户说要发版时",
      script: SCRIPT,
      path: SAVED_PATH,
      overwrite: false,
      scope: "project",
      ...input,
    },
  };
}

function buildListToolCall(output: unknown = LIST_RESULT) {
  return {
    toolId: "tool-list-1",
    toolName: "ListSavedWorkflows",
    kind: "ListSavedWorkflows",
    title: "ListSavedWorkflows",
    status: "completed",
    input: {},
    output,
  };
}

afterEach(cleanup);

describe("normalized saved-run input feeds the existing reader helpers", () => {
  const NORMALIZED_SAVED_RAW = {
    name: "Release check",
    script: SCRIPT,
    saved: {
      name: "release-check",
      path: SAVED_PATH,
      scope: "project",
      args: { target: "packages/ui" },
    },
  };

  it("readWorkflowScript returns the resolved script body", () => {
    expect(readWorkflowScript(NORMALIZED_SAVED_RAW)).toBe(SCRIPT);
  });

  it("readWorkflowName returns the display label", () => {
    expect(readWorkflowName(NORMALIZED_SAVED_RAW)).toBe("Release check");
  });

  it("readWorkflowSaved reads provenance and the validated argument bag", () => {
    const saved = readWorkflowSaved(NORMALIZED_SAVED_RAW);
    expect(saved).toEqual({
      name: "release-check",
      path: SAVED_PATH,
      scope: "project",
      args: { target: "packages/ui" },
    });
  });

  it("treats an inline run as having no saved source", () => {
    expect(readWorkflowSaved({ name: "Inline", script: SCRIPT })).toBeUndefined();
    expect(readWorkflowSaved({ script: SCRIPT, saved: { name: "x" } })?.args).toEqual({});
  });

  it("formats argument values by declared type", () => {
    expect(formatWorkflowArgValue("packages/ui")).toBe("packages/ui");
    expect(formatWorkflowArgValue(false)).toBe("false");
    expect(formatWorkflowArgValue(3)).toBe("3");
    expect(formatWorkflowArgValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("resolveToolCallRenderer saved-workflow dispatch", () => {
  it("routes both tools by name even though shared does not know them", () => {
    expect(resolveToolCallRenderer(buildContext(buildSaveToolCall()))).toBe(
      SaveWorkflowToolCallBlock,
    );
    expect(resolveToolCallRenderer(buildContext(buildListToolCall()))).toBe(
      ListSavedWorkflowsToolCallBlock,
    );
  });

  it("matches the snake_case wire spelling too", () => {
    const snakeCase = { ...buildSaveToolCall(), toolName: "save_workflow", kind: "save_workflow" };
    expect(resolveToolCallRenderer(buildContext(snakeCase))).toBe(SaveWorkflowToolCallBlock);
  });
});

describe("SaveWorkflowToolCallBlock", () => {
  it("collapsed row shows only the name; details live in the expanded body", () => {
    renderCard(
      SaveWorkflowToolCallBlock,
      buildContext(buildSaveToolCall(), { forceOpen: false, canToggle: true }),
    );

    expect(screen.getByText("Saved workflow")).toBeTruthy();
    expect(screen.getByText("release-check")).toBeTruthy();
    expect(screen.queryByText("Pre-release checks: lint, tests, changelog")).toBeNull();
    expect(screen.queryByText(SAVED_PATH)).toBeNull();
    cleanup();

    renderCard(SaveWorkflowToolCallBlock, buildContext(buildSaveToolCall()));
    expect(screen.getByText("Pre-release checks: lint, tests, changelog")).toBeTruthy();
    expect(screen.getByText(SAVED_PATH)).toBeTruthy();
    expect(screen.getByText("用户说要发版时")).toBeTruthy();
    expect(document.body.textContent).not.toContain('await agent("a")');
  });

  it("flags an overwrite and stays silent on a fresh save", () => {
    renderCard(SaveWorkflowToolCallBlock, buildContext(buildSaveToolCall({ overwrite: true })));
    expect(document.querySelector('[data-workflow-overwrite-badge="true"]')?.textContent).toBe(
      "overwrite",
    );
    cleanup();

    renderCard(SaveWorkflowToolCallBlock, buildContext(buildSaveToolCall()));
    expect(document.querySelector('[data-workflow-overwrite-badge="true"]')).toBeNull();
  });

  it("uses the running phrase while the save is in flight", () => {
    renderCard(SaveWorkflowToolCallBlock, buildContext(buildSaveToolCall(), { isRunning: true }));
    expect(screen.getByText("Saving workflow")).toBeTruthy();
  });

  it("renders the overwrite card in zh-CN", () => {
    renderCard(
      SaveWorkflowToolCallBlock,
      buildContext(buildSaveToolCall({ overwrite: true })),
      "zh-CN",
    );
    expect(screen.getByText("已保存工作流")).toBeTruthy();
    expect(document.querySelector('[data-workflow-overwrite-badge="true"]')?.textContent).toBe(
      "覆盖",
    );
  });

  // ── docs/dynamic-workflow/launch.md「`SaveWorkflow`」──
  it("shows a scope row above the path (project vs global) and stays silent on unknown scope", () => {
    renderCard(SaveWorkflowToolCallBlock, buildContext(buildSaveToolCall()));
    expect(screen.getByText("Scope")).toBeTruthy();
    expect(screen.getByText("Project")).toBeTruthy();
    expect(document.querySelector('[data-workflow-scope-badge="global"]')).toBeNull();
    cleanup();

    renderCard(SaveWorkflowToolCallBlock, buildContext(buildSaveToolCall({ scope: "global" })));
    expect(screen.getByText("Global · visible from every project")).toBeTruthy();
    expect(document.querySelector('[data-workflow-scope-badge="global"]')?.textContent).toBe(
      "Global",
    );
    cleanup();

    const { scope: _dropped, ...withoutScope } = buildSaveToolCall().input as Record<
      string,
      unknown
    >;
    renderCard(
      SaveWorkflowToolCallBlock,
      buildContext({ ...buildSaveToolCall(), input: withoutScope }),
    );
    expect(screen.queryByText("Scope")).toBeNull();
    expect(document.querySelector('[data-workflow-scope-badge="global"]')).toBeNull();
  });

  it("explains shadowing in either direction", () => {
    renderCard(
      SaveWorkflowToolCallBlock,
      buildContext(buildSaveToolCall({ scope: "global", shadowing: "hides_global" })),
    );
    expect(
      screen.getByText("A global workflow with this name will be hidden by this one"),
    ).toBeTruthy();
    cleanup();

    renderCard(
      SaveWorkflowToolCallBlock,
      buildContext(buildSaveToolCall({ scope: "project", shadowing: "hidden_by_project" })),
    );
    expect(
      screen.getByText(
        "This project already has a workflow with this name, which will hide this one here",
      ),
    ).toBeTruthy();
  });

  it("renders the scope row in zh-CN too", () => {
    renderCard(
      SaveWorkflowToolCallBlock,
      buildContext(buildSaveToolCall({ scope: "global" })),
      "zh-CN",
    );
    expect(screen.getByText("作用域")).toBeTruthy();
    expect(screen.getByText("全局 · 对所有项目可见")).toBeTruthy();
    expect(document.querySelector('[data-workflow-scope-badge="global"]')?.textContent).toBe(
      "全局",
    );
  });
});

describe("CreateWorkflowToolCallBlock saved source line", () => {
  function buildCreateToolCall(input: Record<string, unknown>) {
    return {
      toolId: "tool-create-1",
      toolName: "CreateWorkflow",
      kind: "CreateWorkflow",
      title: "CreateWorkflow",
      status: "completed",
      input,
    };
  }

  it("names the saved source above the script", () => {
    renderCard(
      CreateWorkflowToolCallBlock,
      buildContext(
        buildCreateToolCall({
          name: "Release check",
          script: SCRIPT,
          saved: {
            name: "release-check",
            path: SAVED_PATH,
            scope: "project",
            args: { target: "packages/ui" },
          },
        }),
      ),
    );

    const line = document.querySelector('[data-workflow-card-saved-source="true"]');
    expect(line).toBeTruthy();
    expect(line?.textContent).toContain("Saved workflow · project");
    expect(line?.textContent).toContain("release-check");
  });

  it("is absent for an inline run", () => {
    renderCard(
      CreateWorkflowToolCallBlock,
      buildContext(buildCreateToolCall({ name: "Inline", script: SCRIPT })),
    );

    expect(document.querySelector('[data-workflow-card-saved-source="true"]')).toBeNull();
  });

  it("renders the source line in zh-CN too", () => {
    renderCard(
      CreateWorkflowToolCallBlock,
      buildContext(
        buildCreateToolCall({
          name: "Release check",
          script: SCRIPT,
          saved: { name: "release-check", path: SAVED_PATH, scope: "project", args: {} },
        }),
      ),
      "zh-CN",
    );

    expect(
      document.querySelector('[data-workflow-card-saved-source="true"]')?.textContent,
    ).toContain("已保存的工作流 · project");
  });
});

describe("ListSavedWorkflowsToolCallBlock", () => {
  it("reads the result from an object or a JSON string", () => {
    expect(readListSavedWorkflowsResult(buildListToolCall())?.workflows).toHaveLength(2);
    expect(
      readListSavedWorkflowsResult(buildListToolCall(JSON.stringify(LIST_RESULT)))?.workflows,
    ).toHaveLength(2);
    expect(readListSavedWorkflowsResult(buildListToolCall("not json"))).toBeNull();
  });

  it("prefers the saved_workflow_list display over the model-facing text projection", () => {
    const toolCall = {
      ...buildListToolCall(
        '<saved_workflows count="1"><workflow name="release-check"/></saved_workflows>',
      ),
      raw: {
        display: {
          kind: "saved_workflow_list",
          workflows: [
            {
              name: "release-check",
              description: "Pre-release checks: lint, tests, changelog",
              scope: "project",
              path: SAVED_PATH,
              argNames: ["target", "skipTests"],
            },
          ],
          invalid: [{ path: "/workspace/.cf/workflows/broken.dwf.ts", reason: "yaml_invalid" }],
        },
      },
    };
    const result = readListSavedWorkflowsResult(toolCall);
    expect(result?.workflows).toHaveLength(1);
    expect(result?.workflows[0]?.argNames).toEqual(["target", "skipTests"]);
    expect(result?.invalid).toHaveLength(1);

    renderCard(ListSavedWorkflowsToolCallBlock, buildContext(toolCall));
    expect(screen.getByText("1 workflow")).toBeTruthy();
    expect(screen.getByText("release-check")).toBeTruthy();
    expect(screen.getByText("target")).toBeTruthy();
    expect(screen.queryByText(/saved_workflows count/)).toBeNull();
  });

  it("lists names, descriptions and argument names instead of a JSON dump", () => {
    renderCard(ListSavedWorkflowsToolCallBlock, buildContext(buildListToolCall()));

    expect(screen.getByText("2 workflows")).toBeTruthy();
    expect(screen.getByText("release-check")).toBeTruthy();
    expect(screen.getByText("translate-docs")).toBeTruthy();
    expect(screen.getByText("Pre-release checks: lint, tests, changelog")).toBeTruthy();
    expect(screen.getByText("target")).toBeTruthy();
    expect(screen.getByText("skipTests")).toBeTruthy();

    expect(document.body.textContent).not.toContain('"toolId"');
    expect(document.body.textContent).not.toContain('"workflows"');
  });

  it("makes broken files visible without failing the whole listing", () => {
    renderCard(ListSavedWorkflowsToolCallBlock, buildContext(buildListToolCall()));

    expect(screen.getByText("1 file could not be read")).toBeTruthy();
    expect(screen.getByText("/workspace/.cf/workflows/broken.dwf.ts")).toBeTruthy();
    expect(screen.getByText("release-check")).toBeTruthy();
  });

  it("says the project has none rather than showing an empty body", () => {
    renderCard(ListSavedWorkflowsToolCallBlock, buildContext(buildListToolCall({ workflows: [] })));

    expect(screen.getAllByText("No saved workflows in this project").length).toBeGreaterThan(0);
  });

  it("uses the singular count for one workflow", () => {
    renderCard(
      ListSavedWorkflowsToolCallBlock,
      buildContext(buildListToolCall({ workflows: [LIST_RESULT.workflows[0]] })),
    );

    expect(screen.getByText("1 workflow")).toBeTruthy();
  });

  it("falls back to the generic card when the result is unreadable", () => {
    renderCard(ListSavedWorkflowsToolCallBlock, buildContext(buildListToolCall("not json")));

    expect(document.querySelector('[data-saved-workflow-list="true"]')).toBeNull();
    expect(document.body.textContent).not.toContain("No saved workflows in this project");
  });

  it("renders the listing in zh-CN", () => {
    renderCard(ListSavedWorkflowsToolCallBlock, buildContext(buildListToolCall()), "zh-CN");
    expect(screen.getByText("已保存的工作流")).toBeTruthy();
    expect(screen.getByText("2 个工作流")).toBeTruthy();
    expect(screen.getByText("1 file cannot be parsed")).toBeTruthy();
  });

  it("tags global-scoped entries next to the name", () => {
    const withGlobal = {
      workflows: [
        LIST_RESULT.workflows[0],
        {
          name: "deep-research",
          description: "深度Research",
          scope: "global",
          path: "/home/.cf/workflows/deep-research.dwf.ts",
        },
      ],
      invalid: [],
    };
    renderCard(
      ListSavedWorkflowsToolCallBlock,
      buildContext(buildListToolCall(withGlobal)),
      "en-US",
    );
    const tag = document.querySelector('[data-workflow-scope-tag="global"]');
    expect(tag?.textContent).toBe("Global");
    expect(document.querySelectorAll('[data-workflow-scope-tag="global"]').length).toBe(1);
  });
});
