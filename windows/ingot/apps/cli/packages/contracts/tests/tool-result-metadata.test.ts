import {
  createWorkflowToolResultDisplayPayloadSchema,
  parseCompletedToolPartMetadata,
  parseToolResultDisplayPayload,
  respondToCoordinatorToolResultDisplayPayloadSchema,
  taskOutputToolResultDisplayPayloadSchema,
  toolResultDisplayPayloadSchema,
} from "../src/tools/tool-result-metadata.js";
import { CreateWorkflowCausalityGraphSchema } from "../src/tools/create-workflow.js";
import {
  getWorkflowRunToolResultDisplayPayloadSchema,
  resumeWorkflowRunToolResultDisplayPayloadSchema,
} from "../src/tools/workflow-observation-display.js";
import { describe, expect, it } from "vitest";

describe("tool result display metadata", () => {
  it("accepts the bounded TaskOutput UI projection", () => {
    const display = {
      kind: "task_output",
      retrievalStatus: "not_ready",
      taskStatus: "running",
      output: "partial output",
      truncated: true,
    } as const;

    expect(taskOutputToolResultDisplayPayloadSchema.parse(display)).toEqual(display);
    expect(parseToolResultDisplayPayload(display)).toEqual(display);
  });

  it("rejects oversized or extra TaskOutput display fields", () => {
    expect(
      taskOutputToolResultDisplayPayloadSchema.safeParse({
        kind: "task_output",
        retrievalStatus: "success",
        taskStatus: "x".repeat(65),
      }).success,
    ).toBe(false);
    expect(
      taskOutputToolResultDisplayPayloadSchema.safeParse({
        kind: "task_output",
        retrievalStatus: "success",
        output: "x".repeat(2_001),
      }).success,
    ).toBe(false);
    expect(
      taskOutputToolResultDisplayPayloadSchema.safeParse({
        kind: "task_output",
        retrievalStatus: "success",
        description: "must not cross the UI display boundary",
      }).success,
    ).toBe(false);
  });

  it.each(["success", "failed"] as const)(
    "accepts RespondToCoordinator %s without response content",
    (status) => {
      const display = {
        kind: "respond_to_coordinator",
        status,
      } as const;

      expect(respondToCoordinatorToolResultDisplayPayloadSchema.parse(display)).toEqual(display);
      expect(parseToolResultDisplayPayload(display)).toEqual(display);
    },
  );

  it("rejects RespondToCoordinator delivery details", () => {
    expect(
      respondToCoordinatorToolResultDisplayPayloadSchema.safeParse({
        kind: "respond_to_coordinator",
        status: "success",
        responseId: "response-1",
      }).success,
    ).toBe(false);
  });

  it("accepts bounded authoritative CUA target-app display metadata", () => {
    const display = {
      kind: "cua",
      schemaVersion: 1,
      toolName: "key",
      status: "success",
      targetApp: {
        schemaVersion: 1,
        displayName: "Calculator",
        iconLocators: [{ kind: "darwin-bundle-id", value: "com.apple.calculator" }],
      },
    } as const;

    expect(parseToolResultDisplayPayload(display)).toEqual(display);
    expect(
      parseToolResultDisplayPayload({
        ...display,
        targetApp: {
          ...display.targetApp,
          iconLocators: [{ kind: "unsupported", value: "forged" }],
        },
      }),
    ).toBeUndefined();
  });

  it("accepts strict request_access permission status and rejects unknown fields", () => {
    const display = {
      kind: "cua",
      schemaVersion: 1,
      toolName: "request_access",
      status: "success",
      permissionStatus: {
        schemaVersion: 1,
        platform: "darwin",
        grantOwner: "dev.cf.cua-helper.dev",
        accessibility: "denied",
        screenRecording: "unknown",
      },
    } as const;

    expect(parseToolResultDisplayPayload(display)).toEqual(display);
    expect(
      parseToolResultDisplayPayload({
        ...display,
        permissionStatus: { ...display.permissionStatus, promptUser: true },
      }),
    ).toBeUndefined();
  });

  it("accepts a bounded CreateWorkflow display with a causality graph", () => {
    const display = {
      kind: "create_workflow",
      ok: true,
      errorCount: 0,
      diagnostics: [],
      causalityGraph: {
        steps: [
          {
            id: "ask#1",
            kind: "ask",
            label: "planner",
            line: 2,
            column: 24,
            lane: "actor#1",
          },
          {
            id: "ask#2",
            kind: "ask",
            label: "reviewer",
            line: 3,
            column: 24,
            lane: "actor#2",
            lanes: ["actor#2", "actor#3"],
            repeat: "stack",
          },
        ],
        lanes: [
          { id: "workspace" },
          { id: "actor#1", name: "planner", line: 2, column: 17 },
          { id: "actor#2", name: "reviewer", line: 3, column: 17 },
        ],
        participants: [
          { id: "unphased:actor#1", phase: "unphased", lane: "actor#1", steps: ["ask#1"] },
          {
            id: "unphased:actor#2",
            phase: "unphased",
            lane: "actor#2",
            steps: ["ask#2"],
            many: true,
          },
        ],
        handoffs: [
          { from: "unphased:actor#1", to: "unphased:actor#2", types: ["Plan"] },
          { from: "unphased:actor#2", to: "unphased:actor#1", back: true },
        ],
        sink: ["ask#1", "ask#2"],
        truncated: true,
      },
    } as const;

    expect(createWorkflowToolResultDisplayPayloadSchema.parse(display)).toEqual(display);
    expect(parseToolResultDisplayPayload(display)).toEqual(display);
  });

  describe("withdrawn refined display names on persisted CreateWorkflow displays", () => {
    const plain = {
      kind: "create_workflow",
      ok: true,
      errorCount: 0,
      diagnostics: [],
      causalityGraph: {
        steps: [{ id: "ask#1", kind: "ask", label: "planner", lane: "actor#1", phase: "phase#1" }],
        lanes: [{ id: "actor#1", name: "planner" }],
        participants: [
          { id: "phase#1:actor#1", phase: "phase#1", lane: "actor#1", steps: ["ask#1"] },
        ],
        handoffs: [],
        phases: [{ id: "phase#1", name: "plan" }],
      },
    } as const;
    const refined = {
      ...plain,
      causalityGraph: {
        ...plain.causalityGraph,
        steps: [{ ...plain.causalityGraph.steps[0], refinedLabel: "拟定计划" }],
        lanes: [{ ...plain.causalityGraph.lanes[0], refinedName: "规划者" }],
        phases: [{ ...plain.causalityGraph.phases[0], refinedName: "规划" }],
      },
    };

    it("the schema itself knows nothing about the withdrawn fields", () => {
      expect(createWorkflowToolResultDisplayPayloadSchema.parse(plain)).toEqual(plain);
      expect(createWorkflowToolResultDisplayPayloadSchema.safeParse(refined).success).toBe(false);
    });

    it("both parse entry points strip the fields before the strict parse", () => {
      expect(parseToolResultDisplayPayload(refined)).toEqual(plain);
      expect(
        parseCompletedToolPartMetadata({ schemaVersion: 1, display: refined })?.display,
      ).toEqual(plain);
    });

    it("leaves other display kinds alone", () => {
      expect(
        parseToolResultDisplayPayload({
          kind: "task_output",
          retrievalStatus: "success",
          refinedName: "x",
        }),
      ).toBeUndefined();
    });
  });

  describe("provider stop details on persisted GetWorkflowRun displays", () => {
    const plain = {
      kind: "get_workflow_run",
      runId: "dwfrun_stopped",
      label: "nightly-sync",
      status: "stopped",
      stopReason: "provider",
      usage: {
        spentTokens: 12_345,
        nodesObserved: 7,
        nodesRunning: 0,
        nodesCompleted: 4,
        nodesFailed: 1,
      },
      actors: [{ siteId: "agent#1", ordinal: 1, name: "scout" }],
      logTail: [{ sequence: 1, message: "started" }],
      error: { code: "ProviderStop", message: "The provider stopped the run: rate limited." },
    } as const;
    const persisted = {
      ...plain,
      error: {
        ...plain.error,
        providerStop: {
          kind: "quota",
          reason: "rate_limited",
          providerId: "bigmodel",
          providerCode: "1308",
        },
      },
    };

    it("the display schema itself knows nothing about providerStop", () => {
      expect(getWorkflowRunToolResultDisplayPayloadSchema.parse(plain)).toEqual(plain);
      expect(getWorkflowRunToolResultDisplayPayloadSchema.safeParse(persisted).success).toBe(false);
    });

    it("both parse entry points strip it before the strict parse", () => {
      expect(parseToolResultDisplayPayload(persisted)).toEqual(plain);
      expect(
        parseCompletedToolPartMetadata({
          schemaVersion: 1,
          display: persisted,
          serialization: {
            truncated: false,
            originalBytes: 128,
            returnedBytes: 128,
            budgetStrategy: "inline",
          },
        })?.display,
      ).toEqual(plain);
    });

    it("leaves a card without an error untouched", () => {
      const { error: _error, ...withoutError } = plain;
      expect(parseToolResultDisplayPayload(withoutError)).toEqual(withoutError);
      expect(Object.keys(parseToolResultDisplayPayload(withoutError) ?? {})).not.toContain("error");
    });

    it("leaves other display kinds alone", () => {
      expect(
        parseToolResultDisplayPayload({
          kind: "list_workflow_runs",
          runs: [],
          error: { code: "ProviderStop", message: "x", providerStop: { kind: "quota" } },
        }),
      ).toBeUndefined();
    });
  });

  it("bounds the CreateWorkflow causality graph strictly", () => {
    const step = {
      id: "ask#1",
      kind: "ask",
      label: "a",
      lane: "actor#1",
    } as const;
    const participant = {
      id: "unphased:actor#1",
      phase: "unphased",
      lane: "actor#1",
      steps: ["ask#1"],
    };
    const base = {
      steps: [step],
      lanes: [{ id: "actor#1" }],
      participants: [participant],
      handoffs: [],
    };
    expect(CreateWorkflowCausalityGraphSchema.safeParse(base).success).toBe(true);

    // 65 steps exceed the 64-step bound.
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({
        ...base,
        steps: Array.from({ length: 65 }, (_, index) => ({ ...step, id: `ask#${index}` })),
      }).success,
    ).toBe(false);
    // 33 lanes exceed the 32-lane bound.
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({
        ...base,
        lanes: Array.from({ length: 33 }, (_, index) => ({ id: `actor#${index}` })),
      }).success,
    ).toBe(false);
    // Step label above the 128-char bound.
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({
        ...base,
        steps: [{ ...step, label: "n".repeat(129) }],
      }).success,
    ).toBe(false);
    // The nested `loc` shape stays inside the analyzer: the payload is flat line/column.
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({
        ...base,
        steps: [{ ...step, loc: { line: 1, column: 1 } }],
      }).success,
    ).toBe(false);
    // Every step needs a lane — the renderer has no default.
    const partial: Record<string, unknown> = { ...step };
    delete partial.lane;
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({ ...base, steps: [partial] }).success,
    ).toBe(false);
    expect(CreateWorkflowCausalityGraphSchema.safeParse({ ...base, edges: [] }).success).toBe(
      false,
    );
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({
        ...base,
        lanes: [{ id: "actor#1", nesting: 1 }],
      }).success,
    ).toBe(false);
    const { participants: _p, ...noParticipants } = base;
    const { handoffs: _h, ...noHandoffs } = base;
    expect(CreateWorkflowCausalityGraphSchema.safeParse(noParticipants).success).toBe(false);
    expect(CreateWorkflowCausalityGraphSchema.safeParse(noHandoffs).success).toBe(false);
    // 65 participants exceed the 64-participant bound.
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({
        ...base,
        participants: Array.from({ length: 65 }, (_, index) => ({
          ...participant,
          id: `unphased:actor#1[${index}]`,
          member: { index, of: 65 },
        })),
      }).success,
    ).toBe(false);
    // A participant with no step is not a card.
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({
        ...base,
        participants: [{ ...participant, steps: [] }],
      }).success,
    ).toBe(false);
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({
        ...base,
        participants: [{ ...participant, id: "unphased:actor#1[2]", member: { index: 2, of: 3 } }],
      }).success,
    ).toBe(true);
    for (const member of [{ index: -1, of: 3 }, { index: 0, of: 0 }, { index: 0 }, { of: 3 }]) {
      expect(
        CreateWorkflowCausalityGraphSchema.safeParse({
          ...base,
          participants: [{ ...participant, member }],
        }).success,
      ).toBe(false);
    }
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({
        ...base,
        participants: [{ ...participant, many: false }],
      }).success,
    ).toBe(false);
    const handoff = { from: "unphased:actor#1", to: "unphased:actor#1" };
    for (const extra of [
      { kind: "data" },
      { kind: "message" },
      { certainty: "always" },
      { exact: true },
      { count: 2 },
    ]) {
      expect(
        CreateWorkflowCausalityGraphSchema.safeParse({
          ...base,
          handoffs: [{ ...handoff, ...extra }],
        }).success,
      ).toBe(false);
    }
    // 257 handoffs exceed the 256-handoff bound.
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({
        ...base,
        handoffs: Array.from({ length: 257 }, () => handoff),
      }).success,
    ).toBe(false);
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({
        ...base,
        handoffs: [{ ...handoff, types: ["Flaky"] }],
      }).success,
    ).toBe(true);
    for (const types of [
      [],
      Array.from({ length: 9 }, (_, i) => `T${i}`),
      [""],
      ["t".repeat(129)],
    ]) {
      expect(
        CreateWorkflowCausalityGraphSchema.safeParse({
          ...base,
          handoffs: [{ ...handoff, types }],
        }).success,
      ).toBe(false);
    }
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({
        ...base,
        handoffs: [{ ...handoff, back: true }],
      }).success,
    ).toBe(true);
    expect(
      CreateWorkflowCausalityGraphSchema.safeParse({
        ...base,
        handoffs: [{ ...handoff, back: false }],
      }).success,
    ).toBe(false);
  });
});

describe("create_workflow display field set (skew tripwire)", () => {
  it("carries exactly the frozen field set", () => {
    expect(Object.keys(createWorkflowToolResultDisplayPayloadSchema.shape).sort()).toEqual([
      "causalityGraph",
      "diagnostics",
      "errorCount",
      "kind",
      "ok",
      "truncated",
    ]);
  });

  it("rejects an extra key outright rather than dropping it", () => {
    const base = { kind: "create_workflow" as const, ok: true, errorCount: 0, diagnostics: [] };
    expect(createWorkflowToolResultDisplayPayloadSchema.safeParse(base).success).toBe(true);
    expect(
      createWorkflowToolResultDisplayPayloadSchema.safeParse({ ...base, script: "return 1;" })
        .success,
    ).toBe(false);
  });

  it("has no save_workflow member in the union", () => {
    expect(
      toolResultDisplayPayloadSchema.safeParse({ kind: "save_workflow", name: "x" }).success,
    ).toBe(false);
  });
});

// spec：docs/dynamic-workflow/presentation.md「The run card」——
describe("resume_workflow_run display payload", () => {
  it("parses the minimal payload and rejects extras", () => {
    expect(
      toolResultDisplayPayloadSchema.safeParse({ kind: "resume_workflow_run", runId: "dwfrun_x" })
        .success,
    ).toBe(true);
    expect(
      toolResultDisplayPayloadSchema.safeParse({
        kind: "resume_workflow_run",
        runId: "dwfrun_x",
        response: "extra",
      }).success,
    ).toBe(false);
  });

  it("carries exactly the frozen field set", () => {
    const schema = resumeWorkflowRunToolResultDisplayPayloadSchema;
    expect(Object.keys(schema.shape).sort()).toEqual(["kind", "runId"]);
  });
});
