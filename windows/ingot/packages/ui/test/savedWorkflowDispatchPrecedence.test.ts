// @vitest-environment jsdom
//
//
//
//

import { cleanup, render, screen } from "@testing-library/react";
import type { CfPermissionRequest } from "@origin-ai/cf-shared";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

vi.mock("@/lib/toolIdentity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/toolIdentity.js")>();
  return {
    ...actual,
    resolveToolCallIdentity: (toolCall: { toolName?: string | null; kind?: string | null }) => {
      const name = toolCall.toolName ?? toolCall.kind ?? "";
      if (name === "SaveWorkflow" || name === "ListSavedWorkflows") {
        return { toolName: name, family: "workflow", source: "toolName", isLegacy: false };
      }
      return actual.resolveToolCallIdentity(toolCall);
    },
  };
});

vi.mock("@/components/ai-elements/code-block.js", () => ({
  CodeBlock: ({ code }: { code: string }) =>
    createElement("pre", { "data-testid": "code-block" }, code),
}));

vi.mock("@/components/workflow-graph/workflow-causality-graph.js", () => ({
  WorkflowCausalityGraph: () => createElement("div", { "data-testid": "workflow-causality-graph" }),
}));

vi.mock("@/components/workflow-graph/workflow-graph-preview-dialog.js", () => ({
  WorkflowGraphPreviewDialog: () => null,
}));

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children?: ReactNode }) => children,
}));

import { PermissionDialog } from "@/PermissionDialog.js";
import { resolveToolCallRenderer } from "@/ToolCallBlocks/resolveRenderer.js";
import { CreateWorkflowToolCallBlock } from "@/ToolCallBlocks/renderers/create-workflow.js";
import { ListSavedWorkflowsToolCallBlock } from "@/ToolCallBlocks/renderers/list-saved-workflows.js";
import { SaveWorkflowToolCallBlock } from "@/ToolCallBlocks/renderers/save-workflow.js";
import { resolveToolCallIdentity } from "@/lib/toolIdentity.js";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";
/* eslint-enable import/first */

const SCRIPT = 'const r = await agent("a").ask<string>("检查");';

function buildContext(toolCall: Record<string, unknown>): ToolCallBlockRenderContext {
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
  } as ToolCallBlockRenderContext;
}

afterEach(cleanup);

describe("saved-workflow dispatch precedence over tool family", () => {
  it("keeps SaveWorkflow on its own card, not the CreateWorkflow card", () => {
    expect(resolveToolCallIdentity({ toolName: "SaveWorkflow" }).family).toBe("workflow");
    const renderer = resolveToolCallRenderer(
      buildContext({
        toolId: "tool-save-1",
        toolName: "SaveWorkflow",
        kind: "SaveWorkflow",
        status: "completed",
        input: { name: "release-check", script: SCRIPT, overwrite: false },
      }),
    );

    expect(renderer).toBe(SaveWorkflowToolCallBlock);
    expect(renderer).not.toBe(CreateWorkflowToolCallBlock);
  });

  it("keeps ListSavedWorkflows on its own card, not the CreateWorkflow card", () => {
    expect(resolveToolCallIdentity({ toolName: "ListSavedWorkflows" }).family).toBe("workflow");
    const renderer = resolveToolCallRenderer(
      buildContext({
        toolId: "tool-list-1",
        toolName: "ListSavedWorkflows",
        kind: "ListSavedWorkflows",
        status: "completed",
        input: {},
        output: { workflows: [], invalid: [] },
      }),
    );

    expect(renderer).toBe(ListSavedWorkflowsToolCallBlock);
    expect(renderer).not.toBe(CreateWorkflowToolCallBlock);
  });

  it("still routes CreateWorkflow itself to the CreateWorkflow card", () => {
    const renderer = resolveToolCallRenderer(
      buildContext({
        toolId: "tool-create-1",
        toolName: "CreateWorkflow",
        kind: "CreateWorkflow",
        status: "completed",
        input: { script: SCRIPT },
      }),
    );

    expect(renderer).toBe(CreateWorkflowToolCallBlock);
  });

  it("keeps the SaveWorkflow gate on the save block, not the run-confirmation block", () => {
    const request = {
      type: "permission_request",
      taskId: "task-1",
      traceId: "trace-1",
      requestId: "perm-save",
      description: "saveWorkflow.confirmation",
      kind: "SaveWorkflow",
      title: "SaveWorkflow",
      options: [
        {
          optionId: "allowOnce",
          kind: "allowOnce",
          name: "Allow",
          response: { decision: "allow" },
        },
        { optionId: "deny", kind: "deny", name: "Deny", response: { decision: "deny" } },
      ],
      raw: {
        name: "release-check",
        description: "发布前检查",
        script: SCRIPT,
        path: "/workspace/.cf/workflows/release-check.dwf.ts",
        overwrite: false,
        scope: "project",
      },
    } as CfPermissionRequest;

    render(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(PermissionDialog, {
          request,
          onRespond: () => {},
          workspacePath: "/workspace",
        }),
      ),
    );

    expect(document.querySelector('[data-save-workflow-permission-block="true"]')).toBeTruthy();
    expect(document.querySelector('[data-workflow-permission-block="true"]')).toBeNull();
    expect(screen.queryByTestId("workflow-causality-graph")).toBeNull();
    expect(document.body.textContent).not.toContain("Run this workflow?");
    expect(screen.getByText("Save this workflow to the project?")).toBeTruthy();
  });
});
