import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AmendWorkflowInputSchema,
  CreateWorkflowInputSchema,
  type CreateWorkflowOutput,
  type DynamicWorkflowRunAmendRequest,
  type DynamicWorkflowRunPort,
  type DynamicWorkflowRunSnapshot,
  type DynamicWorkflowRunSubmitRequest,
  type ModelCatalogEntry,
  type ModelCatalogPort,
  parseWorkflowSettingsAdjustment,
} from "@origin-ai/cf-contracts";
import { MODEL_UNRESOLVED_CODE } from "@origin-ai/cf-dynamic-workflow";
import { amendWorkflowToolEntry } from "../src/tool/handlers/amend-workflow.js";
import { createWorkflowToolEntry } from "../src/tool/handlers/create-workflow.js";
import { analyzeScript } from "../src/tool/handlers/workflow-script-analysis.js";
import { applyWorkflowSettingsAdjustments } from "../src/tool/handlers/workflow-settings-adjustment.js";
import {
  SCRIPT_MODELS_UNAVAILABLE,
  describeScriptModelBindings,
  distinctModelNames,
  resolveScriptModelBindings,
  unresolvedScriptModelDiagnostics,
} from "../src/tool/handlers/workflow-script-models.js";
import type { ToolExecutionContext, ToolInputResolutionContext } from "../src/tool/types.js";

function entry(
  providerId: string,
  modelId: string,
  extra: Partial<ModelCatalogEntry> = {},
): ModelCatalogEntry {
  return { providerId, modelId, reasoningLevels: [], current: false, ...extra };
}

const CATALOG: ModelCatalogPort = {
  listModels: () => [
    entry("zhipu", "GLM-5.3", {
      reasoningLevels: ["low", "high"],
      defaultReasoningLevel: "high",
      current: true,
    }),
    entry("zhipu", "GLM-5.3-Flash"),
    entry("team", "GLM-5.3-Flash"),
    entry("zhipu", "gpt-5"),
    entry("acme", "gpt-5"),
    entry("acme", "atlas"),
  ],
};

const ROUTING_SCRIPT = [
  `const MODELS = { light: model("gpt-5"), strong: model("GLM-5.3") };`,
  `interface Route { tier: "light" | "strong" }`,
  `const route = await agent("分诊", { model: MODELS.light }).ask<Route>("pick");`,
  `const answer = await agent("答复者", { model: MODELS[route.tier] }).ask("go");`,
  `return answer;`,
].join("\n");

const UNKNOWN_MODEL_SCRIPT = [
  `const judge = agent("评审员", { model: "gemini-3" });`,
  `const again = agent("复核员", { model: "gemini-3" });`,
  `await judge.ask("x");`,
  `await again.ask("y");`,
  `return 1;`,
].join("\n");

const cwds: string[] = [];
function makeCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "dwf-script-models-"));
  cwds.push(dir);
  return dir;
}
afterEach(() => {
  while (cwds.length > 0) rmSync(cwds.pop()!, { force: true, recursive: true });
});

interface FakePort {
  port: DynamicWorkflowRunPort;
  submits: DynamicWorkflowRunSubmitRequest[];
  amends: DynamicWorkflowRunAmendRequest[];
}

function fakePort(snapshot: Partial<DynamicWorkflowRunSnapshot> = {}): FakePort {
  const submits: DynamicWorkflowRunSubmitRequest[] = [];
  const amends: DynamicWorkflowRunAmendRequest[] = [];
  const port = {
    async submit(request: DynamicWorkflowRunSubmitRequest) {
      submits.push(request);
      return { ok: true, runId: "dwfrun-new" };
    },
    async amend(request: DynamicWorkflowRunAmendRequest) {
      amends.push(request);
      return { ok: true, runId: "dwfrun-amended" };
    },
    async getTask(taskId: string) {
      return {
        runId: taskId,
        taskId,
        startedAt: new Date(0),
        status: "completed",
        runStatus: "errored",
        ...snapshot,
      } as DynamicWorkflowRunSnapshot;
    },
    async getScript() {
      return ROUTING_SCRIPT;
    },
    defaultConcurrency: () => 6,
  } as unknown as DynamicWorkflowRunPort;
  return { port, submits, amends };
}

function resolutionContext(
  port: DynamicWorkflowRunPort | undefined,
  catalog: ModelCatalogPort | undefined = CATALOG,
  cwd = "/workspace/never-read",
): ToolInputResolutionContext {
  return {
    workingDirectory: cwd,
    ...(port === undefined ? {} : { dynamicWorkflowRunPort: port }),
    ...(catalog === undefined ? {} : { modelCatalogPort: catalog }),
    dynamicWorkflowSkillLoaded: () => true,
  } as unknown as ToolInputResolutionContext;
}

function executionContext(
  cwd: string,
  port: DynamicWorkflowRunPort,
  catalog: ModelCatalogPort | undefined = CATALOG,
): ToolExecutionContext {
  return {
    workingDirectory: cwd,
    sessionId: "sess-1",
    toolCallId: "tool-1",
    dynamicWorkflowRunPort: port,
    ...(catalog === undefined ? {} : { modelCatalogPort: catalog }),
    readFileState: new Map(),
  } as unknown as ToolExecutionContext;
}

async function resolveCreate(
  input: Record<string, unknown>,
  context: ToolInputResolutionContext,
): Promise<Record<string, unknown>> {
  const resolution = await createWorkflowToolEntry.resolveInput!(input, context);
  expect(resolution.result).toBe(true);
  return (resolution as { input: Record<string, unknown> }).input;
}

describe("resolving the names a script uses", () => {
  it("resolves each distinct name once, in first-occurrence order", () => {
    const analysis = analyzeScript(ROUTING_SCRIPT);
    expect(distinctModelNames(analysis.modelReferences)).toEqual(["gpt-5", "GLM-5.3"]);
    expect(resolveScriptModelBindings(["gpt-5", "GLM-5.3"], CATALOG)).toEqual({
      "gpt-5": "zhipu/gpt-5",
      "GLM-5.3": "zhipu/GLM-5.3$high",
    });
  });

  it("keeps an inherited binding (the model the predecessor ran the name on)", () => {
    expect(
      resolveScriptModelBindings(["gpt-5"], CATALOG, { "gpt-5": "zhipu/GLM-5.3$low" }),
    ).toEqual({ "gpt-5": "zhipu/GLM-5.3$low" });
  });

  it("reports one 9011 per unbound name, at its first occurrence, with the resolver's candidates", () => {
    const analysis = analyzeScript(UNKNOWN_MODEL_SCRIPT);
    const diagnostics = unresolvedScriptModelDiagnostics(analysis, {}, CATALOG);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: MODEL_UNRESOLVED_CODE, line: 1 });
    expect(diagnostics[0]!.message).toContain('The model "gemini-3" named in the script');
    expect(diagnostics[0]!.message).toContain("zhipu/GLM-5.3 [current]");
  });

  it("a bare id the session's provider has resolves there, whatever other providers also have it", () => {
    expect(resolveScriptModelBindings(["GLM-5.3-Flash"], CATALOG)).toEqual({
      "GLM-5.3-Flash": "zhipu/GLM-5.3-Flash",
    });
  });

  it("a bare id only other providers have is 9011 naming the boundary, not a silent switch of bill", () => {
    const analysis = analyzeScript(`agent("a", { model: "atlas" });\nreturn 1;`);
    const [diagnostic] = unresolvedScriptModelDiagnostics(analysis, {}, CATALOG);
    expect(diagnostic).toMatchObject({ code: MODEL_UNRESOLVED_CODE, line: 1 });
    expect(diagnostic!.message).toContain("session's provider (zhipu)");
    expect(diagnostic!.message).toContain("acme/atlas");
    expect(diagnostic!.message).toContain("never moves the subagents to another provider");
    expect(resolveScriptModelBindings(["acme/atlas"], CATALOG)).toEqual({
      "acme/atlas": "acme/atlas",
    });
  });

  it("says the inherited model is gone rather than blaming the name", () => {
    const analysis = analyzeScript(`agent("a", { model: "gpt-5" });\nreturn 1;`);
    const [diagnostic] = unresolvedScriptModelDiagnostics(analysis, {}, CATALOG, {
      "gpt-5": "retired/old-model",
    });
    expect(diagnostic!.message).toContain("keeps the model the amended run bound it to");
    expect(diagnostic!.message).toContain("retired/old-model");
  });

  it("a host with no model catalog fails every name with a script-side fix", () => {
    const analysis = analyzeScript(`agent("a", { model: "gpt-5" });\nreturn 1;`);
    const [diagnostic] = unresolvedScriptModelDiagnostics(analysis, {}, undefined);
    expect(diagnostic!.message).toBe(SCRIPT_MODELS_UNAVAILABLE);
  });

  it("describes the table in the canonical spelling the model can paste back", () => {
    expect(describeScriptModelBindings({})).toBe("");
    expect(describeScriptModelBindings({ "gpt-5": "zhipu/gpt-5", x: "zhipu/GLM-5.3$high" })).toBe(
      ' Models named in the script: "gpt-5" = zhipu/gpt-5; "x" = zhipu/GLM-5.3$high.',
    );
  });
});

describe("CreateWorkflow — models the script names", () => {
  it("resolveInput writes the bindings, and a forged table is overwritten", async () => {
    const { port } = fakePort();
    const input = await resolveCreate(
      { script: ROUTING_SCRIPT, model_bindings: { forged: "evil/model" } },
      resolutionContext(port),
    );
    expect(input.model_bindings).toEqual({
      "gpt-5": "zhipu/gpt-5",
      "GLM-5.3": "zhipu/GLM-5.3$high",
    });
    expect(CreateWorkflowInputSchema.safeParse(input).success).toBe(true);
  });

  it("writes no key for a script that names no model, and strips a forged one", async () => {
    const input = await resolveCreate(
      { script: "return 1;", model_bindings: { x: "evil/model" } },
      resolutionContext(fakePort().port),
    );
    expect(Object.hasOwn(input, "model_bindings")).toBe(false);
  });

  it("the window opens only when every name is bound", async () => {
    const context = resolutionContext(fakePort().port);
    const bound = await resolveCreate({ script: ROUTING_SCRIPT }, context);
    expect(createWorkflowToolEntry.prepareApproval!(bound).gate).toBe("ask");
    const unbound = await resolveCreate({ script: UNKNOWN_MODEL_SCRIPT }, context);
    expect(Object.hasOwn(unbound, "model_bindings")).toBe(false);
    expect(createWorkflowToolEntry.prepareApproval!(unbound).gate).toBe("proceed");
  });

  it("an unresolved name is a 9011 diagnostic in file lines, nothing is submitted, the draft is named", async () => {
    const cwd = makeCwd();
    const { port, submits } = fakePort();
    const input = await resolveCreate({ script: UNKNOWN_MODEL_SCRIPT }, resolutionContext(port));
    const output = (await createWorkflowToolEntry.handler(
      input,
      executionContext(cwd, port),
    )) as CreateWorkflowOutput;
    expect(output.ok).toBe(false);
    expect(submits).toHaveLength(0);
    expect(output.diagnostics.map((d) => d.code)).toEqual([MODEL_UNRESOLVED_CODE]);
    expect(output.response).toContain(":L1:C");
    expect(output.response).toContain("gemini-3");
    expect(output.response).toContain("NOTE: The workflow was NOT executed.");
  });

  it("a bound script submits the table as structured selections and names it in the response", async () => {
    const cwd = makeCwd();
    const { port, submits } = fakePort();
    const input = await resolveCreate({ script: ROUTING_SCRIPT }, resolutionContext(port));
    const output = (await createWorkflowToolEntry.handler(
      input,
      executionContext(cwd, port),
    )) as CreateWorkflowOutput;
    expect(output.ok).toBe(true);
    expect(submits).toHaveLength(1);
    expect(submits[0]!.modelBindings).toEqual({
      "gpt-5": { providerId: "zhipu", modelId: "gpt-5" },
      "GLM-5.3": { providerId: "zhipu", modelId: "GLM-5.3", options: { reasoningLevel: "high" } },
    });
    expect(output.response).toContain(
      'Models named in the script: "gpt-5" = zhipu/gpt-5; "GLM-5.3" = zhipu/GLM-5.3$high.',
    );
  });

  it("a script without models submits no modelBindings key", async () => {
    const cwd = makeCwd();
    const { port, submits } = fakePort();
    const input = await resolveCreate({ script: "return 1;" }, resolutionContext(port));
    await createWorkflowToolEntry.handler(input, executionContext(cwd, port));
    expect(Object.hasOwn(submits[0]!, "modelBindings")).toBe(false);
  });
});

describe("the window's settings adjustment", () => {
  const OPTIONS = { errorCode: 400, schema: CreateWorkflowInputSchema };
  const context = resolutionContext(undefined);
  const input = {
    script: ROUTING_SCRIPT,
    model_bindings: { "gpt-5": "zhipu/gpt-5", "GLM-5.3": "zhipu/GLM-5.3$high" },
  };

  it("leaves the bindings as resolved; the answer has no field for them", () => {
    const outcome = applyWorkflowSettingsAdjustments(
      input,
      parseWorkflowSettingsAdjustment({
        max_concurrency: 3,
        model_bindings: { "gpt-5": "zhipu/GLM-5.3$low" },
      }),
      context,
      OPTIONS,
    );
    expect(outcome).toMatchObject({
      result: true,
      input: { ...input, max_concurrency: 3 },
      applied: { max_concurrency: 3 },
    });
  });
});

describe("AmendWorkflow — models the script names", () => {
  async function resolveAmend(
    input: Record<string, unknown>,
    context: ToolInputResolutionContext,
  ): Promise<Record<string, unknown>> {
    const resolution = await amendWorkflowToolEntry.resolveInput!(input, context);
    expect(resolution).toMatchObject({ result: true });
    return (resolution as { input: Record<string, unknown> }).input;
  }

  it("keeps the predecessor's binding for a name it already used and resolves new names", async () => {
    const { port } = fakePort({ modelBindings: { "gpt-5": "zhipu/GLM-5.3$low" } });
    const script = ROUTING_SCRIPT.replace(`model("GLM-5.3")`, `model("GLM-5.3-Flash$x")`).replace(
      `model("GLM-5.3-Flash$x")`,
      `model("zhipu/GLM-5.3-Flash")`,
    );
    const input = await resolveAmend({ run_id: "dwfrun-prev", script }, resolutionContext(port));
    expect(input.model_bindings).toEqual({
      "gpt-5": "zhipu/GLM-5.3$low",
      "zhipu/GLM-5.3-Flash": "zhipu/GLM-5.3-Flash",
    });
    expect(AmendWorkflowInputSchema.safeParse(input).success).toBe(true);
  });

  it("an inherited model that is gone is 9011 saying so; nothing is amended", async () => {
    const cwd = makeCwd();
    const { port, amends } = fakePort({ modelBindings: { "gpt-5": "retired/old" } });
    const input = await resolveAmend(
      {
        run_id: "dwfrun-prev",
        script: `await agent("a", { model: "gpt-5" }).ask("x");\nreturn 1;`,
      },
      resolutionContext(port),
    );
    expect(Object.hasOwn(input, "model_bindings")).toBe(false);
    expect(amendWorkflowToolEntry.prepareApproval!(input).gate).toBe("proceed");
    const output = (await amendWorkflowToolEntry.handler(
      input,
      executionContext(cwd, port),
    )) as CreateWorkflowOutput;
    expect(output.ok).toBe(false);
    expect(amends).toHaveLength(0);
    expect(output.response).toContain("keeps the model the amended run bound it to, retired/old");
  });

  it("hands the resolved table to port.amend", async () => {
    const cwd = makeCwd();
    const { port, amends } = fakePort({ modelBindings: { "gpt-5": "zhipu/GLM-5.3$low" } });
    const input = await resolveAmend(
      { run_id: "dwfrun-prev", script: ROUTING_SCRIPT },
      resolutionContext(port),
    );
    await amendWorkflowToolEntry.handler(input, executionContext(cwd, port));
    expect(amends).toHaveLength(1);
    expect(amends[0]!.modelBindings).toEqual({
      "gpt-5": { providerId: "zhipu", modelId: "GLM-5.3", options: { reasoningLevel: "low" } },
      "GLM-5.3": { providerId: "zhipu", modelId: "GLM-5.3", options: { reasoningLevel: "high" } },
    });
  });
});
