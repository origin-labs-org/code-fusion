import { describe, expect, it } from "vitest";
import { DYNAMIC_WORKFLOW_SKILL_NAME } from "@origin-ai/cf-contracts";
import { FACADE_DTS } from "@origin-ai/cf-dynamic-workflow";
import { AMEND_WORKFLOW_TOOL_DESCRIPTION } from "../src/tool/handlers/amend-workflow-description.js";
import { CREATE_WORKFLOW_TOOL_DESCRIPTION } from "../src/tool/handlers/create-workflow-description.js";
import { EVAL_WORKFLOW_SNIPPET_TOOL_DESCRIPTION } from "../src/tool/handlers/eval-workflow-snippet-description.js";
import { SAVE_WORKFLOW_TOOL_DESCRIPTION } from "../src/tool/handlers/save-workflow-description.js";
import { agentToolEntry } from "../src/tool/handlers/agent.js";
import { amendWorkflowToolEntry } from "../src/tool/handlers/amend-workflow.js";
import { createToolRegistry } from "../src/tool/registry.js";

const DESCRIPTIONS = {
  AmendWorkflow: AMEND_WORKFLOW_TOOL_DESCRIPTION,
  CreateWorkflow: CREATE_WORKFLOW_TOOL_DESCRIPTION,
  EvalWorkflowSnippet: EVAL_WORKFLOW_SNIPPET_TOOL_DESCRIPTION,
  SaveWorkflow: SAVE_WORKFLOW_TOOL_DESCRIPTION,
} as const;

const MAX_DESCRIPTION_CHARS = 2_200;

describe("authoring tool descriptions stay short and point at the skill", () => {
  for (const [name, description] of Object.entries(DESCRIPTIONS)) {
    it(`${name}: no facade, no rule book, a skill pointer, under budget`, () => {
      expect(description.length).toBeLessThan(MAX_DESCRIPTION_CHARS);
      expect(description).not.toContain("declare ");
      expect(description).not.toContain("Authoring rules");
      expect(description).not.toContain("noUncheckedIndexedAccess");
      expect(description).toContain(`\`${DYNAMIC_WORKFLOW_SKILL_NAME}\` skill`);
      expect(description).toContain("Skill tool");
      expect(description).toContain("refused until");
    });
  }
});

describe("CreateWorkflow tool description", () => {
  it("不再自称 placeholder / 不执行", () => {
    const lowered = CREATE_WORKFLOW_TOOL_DESCRIPTION.toLowerCase();
    expect(lowered).not.toContain("placeholder");
    expect(lowered).not.toContain("does not run");
    expect(lowered).not.toContain("not executed");
  });

  it("描述真实执行路径：typecheck → 确认 → 后台 run → 通知", () => {
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("typechecked");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("confirm");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("background");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("notified");
  });

  it("Provide when-to-use and include \"explicit mention binds\"", () => {
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("When to use");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("工作流");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("Agent");
  });

  it("Explicit mention binds is mandatory: list phrases like \"use a workflow / Use workflow\" and forbid rerouting on grounds of being \"too small\"", () => {
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("mandatory");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("use a workflow");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("使用 workflow");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("too small");
  });

  it("只按点名路由：没有编排场景那一条，有明确的否定规则和替代动作", () => {
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).not.toContain("Multi-subagent orchestration");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).not.toContain("deterministic control flow");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain(
      "Without such an explicit request, do not start a workflow",
    );
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain(
      "delegate with the Agent tool or do the work yourself",
    );
  });

  it("留下三条来源、path 回路与 AmendWorkflow 的指路，说明 saved 免技能", () => {
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("exactly one source");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("`saved`");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("resubmit with `path`");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("never paste the script again");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain("call AmendWorkflow instead");
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).toContain(
      "running a saved workflow by name is exempt",
    );
    expect(CREATE_WORKFLOW_TOOL_DESCRIPTION).not.toContain("resume_from");
  });
});

describe("AmendWorkflow tool description", () => {
  it("说清何时修订而不是重建、不要先停不要等、只改设定不带脚本、恢复归 ResumeWorkflowRun", () => {
    expect(AMEND_WORKFLOW_TOOL_DESCRIPTION).toContain("supersedes the old one");
    expect(AMEND_WORKFLOW_TOOL_DESCRIPTION).toContain(
      "Never rewrite the workflow from scratch with CreateWorkflow",
    );
    expect(AMEND_WORKFLOW_TOOL_DESCRIPTION).toContain("Do not TaskStop it first");
    expect(AMEND_WORKFLOW_TOOL_DESCRIPTION).toContain("neither `path` nor `script`");
    expect(AMEND_WORKFLOW_TOOL_DESCRIPTION).toContain("ResumeWorkflowRun");
    expect(AMEND_WORKFLOW_TOOL_DESCRIPTION).toContain("a settings-only call is not");
    expect(AMEND_WORKFLOW_TOOL_DESCRIPTION).not.toContain("in flight starts again");
  });

  it("经 ToolRegistry.toContracts() 投影给模型", () => {
    const registry = createToolRegistry();
    registry.register(amendWorkflowToolEntry);
    const contract = registry.toContracts().find((entry) => entry.name === "AmendWorkflow");
    expect(contract?.description).toContain("Do not TaskStop it first");
    expect(contract?.description).toContain(`\`${DYNAMIC_WORKFLOW_SKILL_NAME}\` skill`);
  });
});

describe("SaveWorkflow tool description", () => {
  it("Always state \"never proactively save\", and specify script_path as the route that avoids re-emitting the script", () => {
    expect(SAVE_WORKFLOW_TOOL_DESCRIPTION).toContain("NEVER call this tool unsolicited");
    expect(SAVE_WORKFLOW_TOOL_DESCRIPTION).toContain("suggest saving it in one sentence and wait");
    expect(SAVE_WORKFLOW_TOOL_DESCRIPTION).toContain("`script_path`");
  });
});

describe("facade prose", () => {
  it("不再把 declare 措辞写成作者指引", () => {
    expect(FACADE_DTS).not.toContain("declared in");
    expect(FACADE_DTS).toContain("an interface you define in");
    expect(FACADE_DTS).toContain('no "declare" modifier');
  });

  it("ambient declare 关键字仍然完整（编译器要的真 d.ts）", () => {
    //
    const declarations = [
      "declare interface Node<T>",
      "declare interface AgentPersona",
      "declare interface Agent",
      "declare function agent(",
      "declare const args",
      "declare function log(",
      "declare function report(",
      "declare interface ArtifactRef",
      "declare interface ArtifactOptions",
      "declare interface ArtifactFileOptions",
      "declare interface ArtifactField",
      "declare interface ChartSpec",
      "declare interface TableSpec",
      "declare interface MetricsSpec",
      "declare interface BoardSpec",
      "declare const artifact",
      "declare function phase(",
      "declare interface GrepMatch",
      "declare const files",
      "declare interface GitStatus",
      "declare interface GitCommit",
      "declare const git",
      "declare interface WorldRunResult",
      "declare const world",
      "declare interface Channel<T>",
      "declare function channel<T>(",
      "declare function future<T>(",
      "declare class ModelRef",
      "declare function model(",
      "declare function hole<T>(name: string, prompt?: string): Promise<T>;",
      "declare function hole<T>(name: string, body: () => Promise<T>): Promise<T>;",
      "declare function hole<T>(name: string, prompt: string, body: () => Promise<T>): Promise<T>;",
    ];
    const keywords = FACADE_DTS.match(/^declare /gm) ?? [];
    expect(keywords).toHaveLength(declarations.length);
    for (const decl of declarations) {
      expect(FACADE_DTS).toContain(decl);
    }
  });
});

describe("Agent tool description", () => {
  it("在 When to use 里交叉指向 CreateWorkflow", () => {
    const description = agentToolEntry.metadata.description ?? "";
    expect(description).toContain("When to use");
    expect(description).toContain("工作流");
    expect(description).toContain("CreateWorkflow");
    expect(description).toContain("mandatory");
    expect(description).toContain("use a workflow");
  });
});

