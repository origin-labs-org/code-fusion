// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CfPermissionRequest } from "@origin-ai/cf-shared";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

vi.mock("@/components/ai-elements/code-block.js", () => ({
  CodeBlock: ({ code }: { code: string }) =>
    createElement("pre", { "data-testid": "code-block" }, code),
}));

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children?: ReactNode }) => children,
}));

import { PermissionDialog } from "@/PermissionDialog.js";

const SCRIPT = 'const x = 1;\nconst r = await agent("a").ask<string>("do");';
const CLI_REASON = "createWorkflow.runConfirmation: user must confirm running the analyzed script";

const CAUSALITY_GRAPH = {
  steps: [
    {
      id: "ask#1",
      kind: "ask" as const,
      label: "a",
      line: 2,
      column: 21,
      lane: "actor#1",
    },
  ],
  lanes: [{ id: "actor#1", name: "a", line: 2, column: 11 }],
  participants: [{ id: "unphased:actor#1", phase: "unphased", lane: "actor#1", steps: ["ask#1"] }],
  handoffs: [],
  sink: ["ask#1"],
};

const SESSION_OPTION = {
  optionId: "allowSession",
  kind: "allowAlways",
  name: "Always allow in this session",
  response: { decision: "allow" as const, reason: "Approved for this session" },
};

function buildWorkflowRequest(
  overrides: Partial<CfPermissionRequest> = {},
): CfPermissionRequest {
  return {
    type: "permission_request",
    taskId: "task-1",
    traceId: "trace-1",
    requestId: "perm-workflow",
    description: CLI_REASON,
    kind: "CreateWorkflow",
    title: "CreateWorkflow",
    options: [
      {
        optionId: "allowOnce",
        kind: "allowOnce",
        name: "Allow",
        response: { decision: "allow" },
      },
      SESSION_OPTION,
      {
        optionId: "deny",
        kind: "deny",
        name: "Deny",
        response: { decision: "deny" },
      },
    ],
    display: {
      kind: "create_workflow",
      ok: true,
      errorCount: 0,
      diagnostics: [],
      causalityGraph: CAUSALITY_GRAPH,
    },
    raw: { name: "Research pipeline", script: SCRIPT },
    ...overrides,
  };
}

function renderDialog(
  request: CfPermissionRequest = buildWorkflowRequest(),
  locale: "en-US" | "zh-CN" = "en-US",
  onRespond: (requestId: string, option: unknown, feedback?: string) => void = () => {},
) {
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: locale },
      createElement(PermissionDialog, {
        request,
        onRespond,
        workspacePath: "/workspace",
      }),
    ),
  );
}

afterEach(() => {
  cleanup();
});

describe("WorkflowPermissionBlock", () => {
  it("renders the timeline as the primary body and keeps the script folded", () => {
    renderDialog();

    const timeline = screen.getByTestId("workflow-timeline");
    expect(timeline.textContent).toContain("Workflow");
    expect(screen.getByTestId("workflow-agent-pill").textContent).toContain("a");
    expect(screen.queryByLabelText("Expand graph")).toBeNull();
    expect(screen.getByText("Research pipeline")).toBeTruthy();
    expect(screen.getByText("Run this workflow?")).toBeTruthy();
    expect(screen.getByTestId("workflow-card-detail").textContent).toBe("1 phase");

    expect(screen.queryByTestId("code-block")).toBeNull();
    expect(document.body.textContent).not.toContain('await agent("a")');
    expect(screen.getByText("Show full script")).toBeTruthy();
  });

  it("renders the localized question in both locales", () => {
    renderDialog(buildWorkflowRequest(), "zh-CN");
    expect(screen.getByText("Run此Workflow？")).toBeTruthy();
    expect(screen.getByText("Show full script")).toBeTruthy();
    cleanup();

    renderDialog(buildWorkflowRequest(), "en-US");
    expect(screen.getByText("Run this workflow?")).toBeTruthy();
  });

  it("asks the question above the workflow name", () => {
    renderDialog();

    const blockText =
      document.querySelector('[data-workflow-permission-block="true"]')?.textContent ?? "";
    expect(blockText.indexOf("Run this workflow?")).toBeGreaterThanOrEqual(0);
    expect(blockText.indexOf("Run this workflow?")).toBeLessThan(
      blockText.indexOf("Research pipeline"),
    );
  });

  it("shows the full script after the fold is toggled open", () => {
    renderDialog();

    fireEvent.click(screen.getByText("Show full script"));

    expect(screen.getByTestId("code-block").textContent).toContain('await agent("a")');
    expect(screen.getByText("Hide full script")).toBeTruthy();
  });

  it("opens the script by default when there is no graph to show", () => {
    renderDialog(
      buildWorkflowRequest({
        display: { kind: "create_workflow", ok: true, errorCount: 0, diagnostics: [] },
      }),
    );

    expect(screen.queryByTestId("workflow-timeline")).toBeNull();
    expect(screen.getByTestId("code-block").textContent).toContain('await agent("a")');
    expect(screen.getByText("Hide full script")).toBeTruthy();
  });

  it("treats a participant-less graph as no graph", () => {
    renderDialog(
      buildWorkflowRequest({
        display: {
          kind: "create_workflow",
          ok: true,
          errorCount: 0,
          diagnostics: [],
          causalityGraph: { steps: [], lanes: [], participants: [], handoffs: [] },
        },
      }),
    );

    expect(screen.queryByTestId("workflow-timeline")).toBeNull();
    expect(screen.getByTestId("code-block")).toBeTruthy();
  });

  it("degrades to an open script when the ask carries no preview at all", () => {
    renderDialog(buildWorkflowRequest({ display: undefined }));

    expect(screen.queryByTestId("workflow-timeline")).toBeNull();
    expect(screen.getByTestId("code-block").textContent).toContain('await agent("a")');
    expect(screen.getByText("Run this workflow?")).toBeTruthy();
  });

  it("renders header and question without crashing when the input has no script", () => {
    renderDialog(buildWorkflowRequest({ display: undefined, raw: { name: "Broken input" } }));

    expect(screen.getByText("Run this workflow?")).toBeTruthy();
    expect(screen.getByText("Broken input")).toBeTruthy();
    expect(screen.queryByTestId("code-block")).toBeNull();
    expect(screen.queryByText("Show full script")).toBeNull();
  });

  function buildAmendRequest(raw: Record<string, unknown>): CfPermissionRequest {
    return buildWorkflowRequest({
      kind: "AmendWorkflow",
      title: "AmendWorkflow",
      description: "amendWorkflow.runConfirmation: user must confirm running the revised script",
      raw,
    });
  }

  it("asks 'Amend this workflow?' with the lineage line for an AmendWorkflow ask", () => {
    renderDialog(
      buildAmendRequest({
        name: "Research pipeline",
        script: SCRIPT,
        run_id: "dwfrun-prev",
        predecessor: { status: "completed", owned_by_this_session: false },
      }),
    );

    expect(screen.getByTestId("workflow-card-kind").textContent).toBe("Amend this workflow?");
    expect(document.body.textContent).not.toContain("Run this workflow?");
    const lineage = document.querySelector('[data-workflow-amends="true"]');
    expect(lineage).toBeTruthy();
    expect(lineage?.textContent).toContain("Amends run");
    expect(lineage?.textContent).toContain("dwfrun-prev");
    expect(lineage?.getAttribute("data-workflow-amends-live")).toBeNull();
    expect(lineage?.textContent).not.toContain("still running");
    expect(screen.getByTestId("workflow-timeline")).toBeTruthy();
    expect(screen.queryByTestId("code-block")).toBeNull();
  });

  it.each(["running", "pending"] as const)(
    "says the predecessor will be stopped when it is still in flight (%s)",
    (status) => {
      renderDialog(
        buildAmendRequest({
          script: SCRIPT,
          run_id: "dwfrun-live",
          predecessor: { status, owned_by_this_session: false },
        }),
      );

      const lineage = document.querySelector('[data-workflow-amends="true"]');
      expect(lineage?.getAttribute("data-workflow-amends-live")).toBe("true");
      expect(lineage?.textContent).toContain("still running, will be stopped");
    },
  );

  it("localizes the amend title and lineage", () => {
    renderDialog(
      buildAmendRequest({
        name: "Research pipeline",
        script: SCRIPT,
        run_id: "dwfrun-prev",
        predecessor: { status: "running", owned_by_this_session: false },
      }),
      "zh-CN",
    );

    expect(screen.getByTestId("workflow-card-kind").textContent).toBe("调整此Workflow？");
    const lineage = document.querySelector('[data-workflow-amends="true"]');
    expect(lineage?.textContent).toContain("调整 run");
    expect(lineage?.textContent).toContain("dwfrun-prev");
    expect(lineage?.textContent).toContain("仍在Run，k被Stop");
  });

  it("says 'script unchanged' on the lineage line when the amend keeps the predecessor's script", () => {
    renderDialog(
      buildAmendRequest({
        script: SCRIPT,
        run_id: "dwfrun-prev",
        max_concurrency: 2,
        predecessor: { status: "running", owned_by_this_session: false, script_inherited: true },
      }),
    );

    const lineage = document.querySelector('[data-workflow-amends="true"]');
    expect(lineage?.getAttribute("data-workflow-amends-script-inherited")).toBe("true");
    expect(lineage?.textContent).toContain("dwfrun-prev");
    expect(lineage?.textContent).toContain("script unchanged");
    expect(lineage?.textContent).toContain("still running, will be stopped");
    expect(screen.getByTestId("workflow-timeline")).toBeTruthy();
    expect(screen.getByText("Show full script")).toBeTruthy();
    expect(screen.getByTestId("workflow-permission-max-concurrency").textContent).toBe(
      "At most 2 subagents at once",
    );
  });

  it("says nothing about the script when the amend passes one", () => {
    renderDialog(
      buildAmendRequest({
        script: SCRIPT,
        run_id: "dwfrun-prev",
        predecessor: { status: "completed", owned_by_this_session: false },
      }),
    );

    const lineage = document.querySelector('[data-workflow-amends="true"]');
    expect(lineage?.getAttribute("data-workflow-amends-script-inherited")).toBeNull();
    expect(lineage?.textContent).not.toContain("script unchanged");
  });

  it("localizes 'script unchanged'", () => {
    renderDialog(
      buildAmendRequest({
        script: SCRIPT,
        run_id: "dwfrun-prev",
        predecessor: { status: "completed", owned_by_this_session: false, script_inherited: true },
      }),
      "zh-CN",
    );

    const lineage = document.querySelector('[data-workflow-amends="true"]');
    expect(lineage?.textContent).toContain("脚本不变");
  });

  it("omits the lineage line entirely for a CreateWorkflow ask", () => {
    renderDialog();

    expect(screen.getByTestId("workflow-card-kind").textContent).toBe("Run this workflow?");
    expect(document.querySelector('[data-workflow-amends="true"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Amends run");
  });

  it("ignores a blank run_id instead of rendering an empty lineage", () => {
    renderDialog(buildAmendRequest({ script: SCRIPT, run_id: "  " }));

    expect(document.querySelector('[data-workflow-amends="true"]')).toBeNull();
  });

  function queryMaxConcurrency(): HTMLElement | null {
    return screen.queryByTestId("workflow-permission-max-concurrency");
  }

  it("says how many subagents may run at once when the input carries max_concurrency", () => {
    renderDialog(
      buildWorkflowRequest({
        raw: { name: "Research pipeline", script: SCRIPT, max_concurrency: 3 },
      }),
    );

    expect(queryMaxConcurrency()?.textContent).toBe("At most 3 subagents at once");
  });

  it("shows the same row for an AmendWorkflow ask, right after the lineage row", () => {
    renderDialog(
      buildAmendRequest({
        script: SCRIPT,
        run_id: "dwfrun-prev",
        predecessor: { status: "completed", owned_by_this_session: false },
        max_concurrency: 2,
      }),
    );

    expect(queryMaxConcurrency()?.textContent).toBe("At most 2 subagents at once");
    const blockText =
      document.querySelector('[data-workflow-permission-block="true"]')?.textContent ?? "";
    expect(blockText.indexOf("Amends run")).toBeLessThan(blockText.indexOf("At most 2"));
  });

  it("localizes the row", () => {
    renderDialog(buildWorkflowRequest({ raw: { script: SCRIPT, max_concurrency: 4 } }), "zh-CN");

    expect(queryMaxConcurrency()?.textContent).toBe("最多 4 个Sub-agent同时Run");
  });

  it.each([
    ["omitted", {}],
    ["null (the amend 'remove the limit' value)", { max_concurrency: null }],
    ["not a positive integer", { max_concurrency: 0 }],
    ["not an integer", { max_concurrency: 2.5 }],
  ])("renders no row when max_concurrency is %s", (_case, extra) => {
    renderDialog(buildWorkflowRequest({ raw: { script: SCRIPT, ...extra } }));

    expect(queryMaxConcurrency()).toBeNull();
    expect(document.body.textContent).not.toContain("subagents at once");
  });

  const TEAM_PLAN_MODEL = "4fc7f541-2382-4c32-be11-f021b8d7ed1d/GLM-5.3-Flash$high";

  function querySubagentModel(): HTMLElement | null {
    return screen.queryByTestId("workflow-permission-subagent-model");
  }

  it("says which model the subagents run on, by name and not by canonical string", () => {
    renderDialog(
      buildWorkflowRequest({
        raw: {
          name: "Research pipeline",
          script: SCRIPT,
          subagent_model: "zhipu/glm-5.3-flash",
        },
      }),
    );

    expect(querySubagentModel()?.textContent).toBe("Subagents run on glm-5.3-flash");
  });

  it("never shows the provider id, even when it is a team-plan UUID", () => {
    renderDialog(
      buildWorkflowRequest({ raw: { script: SCRIPT, subagent_model: TEAM_PLAN_MODEL } }),
    );

    const row = querySubagentModel();
    expect(row?.textContent).toContain("GLM-5.3-Flash");
    expect(row?.textContent).not.toContain("4fc7f541");
    expect(row?.getAttribute("title")).toContain(TEAM_PLAN_MODEL);
  });

  it("keeps the reasoning level, as a word: the level is part of the choice being approved", () => {
    renderDialog(
      buildWorkflowRequest({ raw: { script: SCRIPT, subagent_model: "anthropic/opus-5$high" } }),
    );

    expect(querySubagentModel()?.textContent).toBe("Subagents run on opus-5 · thinking High");
  });

  it("sits directly above the concurrency row, and shows on an AmendWorkflow ask too", () => {
    renderDialog(
      buildAmendRequest({
        script: SCRIPT,
        run_id: "dwfrun-prev",
        predecessor: { status: "completed", owned_by_this_session: false },
        max_concurrency: 2,
        subagent_model: "zhipu/glm-5.3-flash",
      }),
    );

    expect(querySubagentModel()?.textContent).toBe("Subagents run on glm-5.3-flash");
    const blockText =
      document.querySelector('[data-workflow-permission-block="true"]')?.textContent ?? "";
    expect(blockText.indexOf("Subagents run on")).toBeLessThan(blockText.indexOf("At most 2"));
  });

  it("localizes the subagent-model row, leaving the model name untranslated", () => {
    renderDialog(
      buildWorkflowRequest({ raw: { script: SCRIPT, subagent_model: "anthropic/opus-5$high" } }),
      "zh-CN",
    );

    expect(querySubagentModel()?.textContent).toBe("Sub-agentRun在 opus-5 · Thinking High");
  });

  it.each([
    ["omitted", {}],
    ["null (the amend 'back to the session model' value)", { subagent_model: null }],
    ["blank", { subagent_model: "   " }],
    ["not a string", { subagent_model: { providerId: "zhipu", modelId: "glm-5.3-flash" } }],
  ])("renders no row when subagent_model is %s", (_case, extra) => {
    renderDialog(buildWorkflowRequest({ raw: { script: SCRIPT, ...extra } }));

    expect(querySubagentModel()).toBeNull();
    expect(document.body.textContent).not.toContain("Subagents run on");
  });
});

describe("PermissionDialog workflow dispatch", () => {
  it("renders the workflow block instead of the fallback JSON dump", () => {
    renderDialog();

    expect(document.querySelector('[data-workflow-permission-block="true"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain('"script"');
    expect(document.body.textContent).not.toContain("toolName");
  });

  it("suppresses the diagnostic CLI reason", () => {
    renderDialog();

    expect(document.body.textContent).not.toContain(CLI_REASON);
    expect(document.body.textContent).not.toContain("createWorkflow.runConfirmation");
  });

  it("renders Run / Always allow in this session / Deny, in that order", () => {
    renderDialog();

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options.map((option) => option.getAttribute("data-permission-option-kind"))).toEqual([
      "allowOnce",
      "allowAlways",
      "rejectOnce",
    ]);
    expect(document.body.textContent).toContain("Allow");
    expect(document.body.textContent).toContain("Deny");
  });

  it.each([
    ["en-US", "Always allow in this session", "Do not ask again for workflows in this session"],
    ["zh-CN", "本SessioninnerAlways allow", "本SessioninnerRun Workflow不再询Question"],
  ] as const)("localizes the session option in %s", (locale, label, description) => {
    renderDialog(buildWorkflowRequest(), locale);

    const option = document.querySelector('[data-permission-option-kind="allowAlways"]')!;
    expect(option.textContent).toContain(label);
    expect(option.textContent).toContain(description);
    expect(option.textContent).not.toContain("same permission request");
    expect(option.textContent).not.toContain("E同Permission request");
  });

  it("clicking the session option responds with optionId allowSession and no feedback", () => {
    const onRespond = vi.fn();
    renderDialog(buildWorkflowRequest(), "en-US", onRespond);

    const session = document.querySelector('[data-permission-option-kind="allowAlways"]')!;
    fireEvent.click(session);
    expect(onRespond).not.toHaveBeenCalled();
    fireEvent.click(session);

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith(
      "perm-workflow",
      expect.objectContaining({ optionId: "allowSession" }),
      undefined,
    );
  });

  it("the session option is not rendered when the CLI does not offer it (no-always-allow tools)", () => {
    const base = buildWorkflowRequest();
    renderDialog({
      ...base,
      options: base.options.filter((option) => option.optionId !== "allowSession"),
    });

    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(document.querySelectorAll('[data-permission-option-kind="allowAlways"]')).toHaveLength(
      0,
    );
  });

  it("still renders the graph when the ask carries no workflow name", () => {
    renderDialog(buildWorkflowRequest({ raw: { script: SCRIPT } }));

    expect(screen.getByTestId("workflow-timeline")).toBeTruthy();
    expect(screen.getByText("Workflow script")).toBeTruthy();
  });
});

const REFINE_OPTION = {
  optionId: "workflowRefine",
  kind: "custom",
  name: "Refine",
  response: { decision: "deny" as const, reason: "Denied" },
};

function buildRefineRequest(): CfPermissionRequest {
  const base = buildWorkflowRequest();
  return { ...base, options: [...base.options, REFINE_OPTION] };
}

function queryRefineInput(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(
    '[data-permission-feedback-option="workflowRefine"]',
  );
}

describe("PermissionDialog workflow refine", () => {
  it("Refine 渲染为紧随 Run/Deny 的编NumberFeedback行，而不Yes第Three个选项按钮", () => {
    renderDialog(buildRefineRequest(), "en-US");

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(screen.queryByRole("option", { name: "Refine" })).toBeNull();

    const input = queryRefineInput();
    expect(input).toBeTruthy();
    expect(input!.closest('[role="listbox"]')).toBeNull();
    expect(input!.previousElementSibling?.textContent).toBe("4.");
    expect(input!.placeholder).toBe("Describe how the workflow should change…");
    expect(input!.getAttribute("aria-label")).toBe("Refine");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it.each(["Enter", "confirm"])(
    "Passed %s Submit把 trim 后的 freeText 连同 Refine 选项交To onRespond；空白禁发",
    (method) => {
      const onRespond = vi.fn();
      renderDialog(buildRefineRequest(), "en-US", onRespond);
      const input = queryRefineInput()!;
      const confirm = screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement;

      act(() => input.focus());
      fireEvent.change(input, { target: { value: "   " } });
      expect(confirm.disabled).toBe(true);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onRespond).not.toHaveBeenCalled();

      fireEvent.change(input, { target: { value: " 只RetainThree个 finder " } });
      expect(confirm.disabled).toBe(false);
      if (method === "Enter") fireEvent.keyDown(input, { key: "Enter" });
      else fireEvent.click(confirm);

      expect(onRespond).toHaveBeenCalledTimes(1);
      expect(onRespond).toHaveBeenCalledWith(
        "perm-workflow",
        expect.objectContaining({ optionId: "workflowRefine" }),
        "只RetainThree个 finder",
      );
    },
  );

  it("Esc 只让Input行失焦并RetainDraft（同通用Feedback行，不再Collapse什么）", () => {
    const onRespond = vi.fn();
    renderDialog(buildRefineRequest(), "en-US", onRespond);
    const input = queryRefineInput()!;

    act(() => input.focus());
    fireEvent.change(input, { target: { value: "先Run lint 再 fan out" } });

    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.activeElement).not.toBe(input);
    expect(queryRefineInput()!.value).toBe("先Run lint 再 fan out");
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("方向键在 Run / Session / Deny 与 Refine 行之间循环，CountCharacter 4 直达 Refine 行", async () => {
    renderDialog(buildRefineRequest(), "en-US");
    const options = screen.getAllByRole("option");
    const input = queryRefineInput()!;
    const row = input.parentElement!;

    await waitFor(() => {
      expect(document.activeElement).toBe(options[0]);
    });
    fireEvent.keyDown(options[0]!, { key: "ArrowUp" });
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    expect(row.classList.contains("bg-selected")).toBe(true);
    expect(options.every((option) => option.getAttribute("aria-selected") === "false")).toBe(true);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => {
      expect(document.activeElement).toBe(options[0]);
    });
    expect(row.classList.contains("bg-selected")).toBe(false);

    fireEvent.keyDown(options[0]!, { key: "4" });
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it("Run / Deny 的即时应Answer语义不受 Refine 行影响；Deny 不携带 Refine Draft", () => {
    const onRespond = vi.fn();
    renderDialog(buildRefineRequest(), "en-US", onRespond);

    const input = queryRefineInput()!;
    fireEvent.change(input, { target: { value: "把 fan out 改成串行" } });

    const deny = screen.getByRole("option", { name: "Deny" });
    fireEvent.click(deny);
    expect(onRespond).not.toHaveBeenCalled();
    fireEvent.click(deny);
    expect(onRespond).toHaveBeenCalledWith(
      "perm-workflow",
      expect.objectContaining({ optionId: "deny" }),
      undefined,
    );
  });

  it("双语渲染 Refine 行Copy", () => {
    renderDialog(buildRefineRequest(), "zh-CN");
    expect(queryRefineInput()!.placeholder).toBe("描述这个Workflow应该怎么改…");
    expect(queryRefineInput()!.getAttribute("aria-label")).toBe("提出修改");
    cleanup();

    renderDialog(buildRefineRequest(), "en-US");
    expect(queryRefineInput()!.placeholder).toBe("Describe how the workflow should change…");
  });
});
