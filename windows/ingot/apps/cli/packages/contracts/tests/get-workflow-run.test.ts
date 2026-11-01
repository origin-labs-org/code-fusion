import { describe, expect, it } from "vitest";
import {
  GET_WORKFLOW_RUN_TOOL_NAME,
  GetWorkflowRunInputJsonSchema,
  GetWorkflowRunInputSchema,
  GetWorkflowRunOutputJsonSchema,
  GetWorkflowRunOutputSchema,
} from "../src/tools/get-workflow-run.js";

const RUNNING = {
  runId: "dwfrun-1",
  label: "// triage the failing tests",
  labelSource: "script" as const,
  status: "running" as const,
  ownedByThisSession: true,
  createdAt: 1_755_000_000_000,
  updatedAt: 1_755_000_001_000,
  summary: "Running for 1m 00s. 2 of 3 dispatched steps settled, 1 running (1 executing).",
  generatedAt: 1_755_000_001_500,
  usage: {
    spentTokens: 1_204,
    nodesObserved: 3,
    nodesRunning: 1,
    nodesCompleted: 2,
    nodesFailed: 0,
  },
  actors: [{ siteId: "agent#1", ordinal: 1, name: "judge" }],
  logTail: [{ sequence: 12, message: "collected the failing specs" }],
  subagents: [
    {
      siteId: "agent#1",
      ordinal: 1,
      name: "judge",
      state: "executing" as const,
      stepsSettled: 2,
      stepsFailed: 0,
      tokens: 1_204,
    },
  ],
  health: { consecutiveFailures: 0, cachedSteps: 0, pendingQuestionsKnown: true },
};

describe("GetWorkflowRun input schema", () => {
  it("names the tool exactly as it registers", () => {
    expect(GET_WORKFLOW_RUN_TOOL_NAME).toBe("GetWorkflowRun");
  });

  it("requires a non-empty snake_case run_id", () => {
    expect(GetWorkflowRunInputSchema.parse({ run_id: "dwfrun-1" })).toEqual({
      run_id: "dwfrun-1",
    });
    expect(GetWorkflowRunInputSchema.safeParse({ run_id: "" }).success).toBe(false);
    expect(GetWorkflowRunInputSchema.safeParse({}).success).toBe(false);
    expect(GetWorkflowRunInputSchema.safeParse({ runId: "dwfrun-1" }).success).toBe(false);
  });

  it("stays strict about unknown keys", () => {
    expect(
      GetWorkflowRunInputSchema.safeParse({ run_id: "dwfrun-1", logTailLimit: 100 }).success,
    ).toBe(false);
  });

  it("requires run_id in the model-facing JSON schema", () => {
    const schema = GetWorkflowRunInputJsonSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {})).toEqual(["run_id"]);
    expect(schema.required).toEqual(["run_id"]);
  });
});

describe("GetWorkflowRun output schema", () => {
  it("roundtrips a running run with neither result nor error", () => {
    const parsed = GetWorkflowRunOutputSchema.parse(RUNNING);
    expect(parsed).toEqual(RUNNING);
    expect("result" in parsed).toBe(false);
    expect("error" in parsed).toBe(false);
  });

  it("round-trips a subagent model and keeps it absent when the run inherits the session model", () => {
    const withModel = GetWorkflowRunOutputSchema.parse({
      ...RUNNING,
      subagentModel: "zhipu/glm-5.3$high",
    });
    expect(withModel.subagentModel).toBe("zhipu/glm-5.3$high");
    expect("subagentModel" in GetWorkflowRunOutputSchema.parse(RUNNING)).toBe(false);
  });

  it("round-trips the run's script file and keeps it absent when the run recorded none", () => {
    const withPath = GetWorkflowRunOutputSchema.parse({
      ...RUNNING,
      scriptPath: ".cf/workflow-drafts/audit.dwf.ts",
    });
    expect(withPath.scriptPath).toBe(".cf/workflow-drafts/audit.dwf.ts");
    expect("scriptPath" in GetWorkflowRunOutputSchema.parse(RUNNING)).toBe(false);
  });

  it("accepts a completed run whose result is the serialized artifact", () => {
    const output = {
      ...RUNNING,
      status: "completed" as const,
      result: '{\n  "verdict": "ship"\n}',
    };
    expect(GetWorkflowRunOutputSchema.parse(output)).toEqual(output);
  });

  it("accepts an errored run and keeps the failure code verbatim", () => {
    for (const code of ["DriverError", "ReportCapExceeded"]) {
      const output = {
        ...RUNNING,
        status: "errored" as const,
        error: { code, message: `run ended: ${code}` },
      };
      expect(GetWorkflowRunOutputSchema.parse(output).error).toEqual({
        code,
        message: `run ended: ${code}`,
      });
    }
  });

  it("accepts a stopped run with its reason and a provider stop's details", () => {
    const interrupted = {
      ...RUNNING,
      status: "stopped" as const,
      stopReason: "interrupted" as const,
      error: { code: "Interrupted", message: "the owning process exited" },
    };
    expect(GetWorkflowRunOutputSchema.parse(interrupted)).toEqual(interrupted);

    const providerStop = {
      ...RUNNING,
      status: "stopped" as const,
      stopReason: "provider" as const,
      error: {
        code: "ProviderStop",
        message: "Subagent turn failed: [1006] token expired",
        providerStop: {
          kind: "auth" as const,
          reason: "auth_failed",
          providerId: "account:bigmodel-coding-plan",
          modelId: "GLM-5.3",
          providerCode: "1006",
          subagent: "verify@2",
          rawMessage: "[1006] token expired",
        },
      },
    };
    expect(GetWorkflowRunOutputSchema.parse(providerStop)).toEqual(providerStop);
    expect(
      GetWorkflowRunOutputSchema.safeParse({ ...RUNNING, status: "stopped", stopReason: "crash" })
        .success,
    ).toBe(false);
    expect(
      GetWorkflowRunOutputSchema.safeParse({
        ...providerStop,
        error: {
          ...providerStop.error,
          providerStop: { ...providerStop.error.providerStop, kind: "bogus" },
        },
      }).success,
    ).toBe(false);
  });

  it("carries the actor name only when present", () => {
    const parsed = GetWorkflowRunOutputSchema.parse({
      ...RUNNING,
      actors: [{ siteId: "agent#1", ordinal: 1 }],
    });
    expect("name" in parsed.actors[0]!).toBe(false);
  });

  it("has no cap fields on usage: budgetTotal / maxNodes are unknown keys", () => {
    for (const extra of [{ budgetTotal: 200_000 }, { maxNodes: 100 }]) {
      expect(
        GetWorkflowRunOutputSchema.safeParse({ ...RUNNING, usage: { ...RUNNING.usage, ...extra } })
          .success,
      ).toBe(false);
    }
  });

  it("accepts empty actor and log collections", () => {
    const parsed = GetWorkflowRunOutputSchema.parse({ ...RUNNING, actors: [], logTail: [] });
    expect(parsed.actors).toEqual([]);
    expect(parsed.logTail).toEqual([]);
  });

  it("requires the whole node-count block: a partial usage is a shape error", () => {
    expect(
      GetWorkflowRunOutputSchema.safeParse({
        ...RUNNING,
        usage: { spentTokens: 1, nodesObserved: 3 },
      }).success,
    ).toBe(false);
  });

  it("stays strict about unknown keys at every level", () => {
    expect(GetWorkflowRunOutputSchema.safeParse({ ...RUNNING, elapsedMs: 12 }).success).toBe(false);
    expect(
      GetWorkflowRunOutputSchema.safeParse({
        ...RUNNING,
        usage: { ...RUNNING.usage, budgetRemaining: 1 },
      }).success,
    ).toBe(false);
    expect(
      GetWorkflowRunOutputSchema.safeParse({
        ...RUNNING,
        actors: [{ siteId: "agent#1", ordinal: 1, persona: "you are…" }],
      }).success,
    ).toBe(false);
    expect(
      GetWorkflowRunOutputSchema.safeParse({
        ...RUNNING,
        logTail: [{ sequence: 1, message: "hi", timestamp: 0 }],
      }).success,
    ).toBe(false);
  });

  // ————————————————————————————————————————————————
  // ————————————————————————————————————————————————

  it("takes an optional journal time on a log entry and keeps it absent otherwise", () => {
    const timed = GetWorkflowRunOutputSchema.parse({
      ...RUNNING,
      logTail: [{ sequence: 12, message: "collected the failing specs", at: 1_755_000_000_500 }],
    });
    expect(timed.logTail[0]?.at).toBe(1_755_000_000_500);
    expect("at" in GetWorkflowRunOutputSchema.parse(RUNNING).logTail[0]!).toBe(false);
  });

  it("round-trips a phase table and rejects a state outside the closed set", () => {
    const withPhases = {
      ...RUNNING,
      phases: [
        { name: "collect", state: "done" as const, rounds: 1, nodesSettled: 2, nodesRunning: 0, enteredAt: 1, exitedAt: 2 },
        { name: "judge", state: "current" as const, rounds: 1, nodesSettled: 3, nodesRunning: 2, enteredAt: 2 },
        { name: "verify", state: "ahead" as const, rounds: 0, nodesSettled: 0, nodesRunning: 0 },
      ],
    };
    expect(GetWorkflowRunOutputSchema.parse(withPhases)).toEqual(withPhases);
    expect("phases" in GetWorkflowRunOutputSchema.parse(RUNNING)).toBe(false);
    expect(
      GetWorkflowRunOutputSchema.safeParse({
        ...RUNNING,
        phases: [{ name: "judge", state: "skipped", rounds: 1, nodesSettled: 0, nodesRunning: 0 }],
      }).success,
    ).toBe(false);
  });

  it("round-trips a full subagent row and keeps every progress reading optional", () => {
    const full = {
      ...RUNNING,
      subagents: [
        {
          siteId: "agent#2",
          ordinal: 1,
          name: "judge",
          state: "executing" as const,
          phaseName: "judge",
          currentAsk: {
            siteId: "ask#4",
            ordinal: 1,
            actorSeq: 2,
            instructionsHead: "Judge specs 1-7 for flakiness",
            startedAt: 1_755_000_000_100,
            turn: 4,
            toolCalls: 7,
            lastTool: { name: "Read", target: "packages/net/retry.spec.ts", at: 1_755_000_001_000 },
          },
          wait: { cause: "backoff" as const, reason: "429", retryAfterMs: 20_000, since: 1_755_000_000_900 },
          parkedOn: "dwfq-1",
          stepsSettled: 2,
          stepsFailed: 1,
          tokens: 5_100,
          lastProgressAt: 1_755_000_001_000,
        },
      ],
    };
    expect(GetWorkflowRunOutputSchema.parse(full)).toEqual(full);

    const bare = GetWorkflowRunOutputSchema.parse(RUNNING).subagents[0]!;
    for (const key of ["currentAsk", "wait", "parkedOn", "phaseName", "lastProgressAt"]) {
      expect(key in bare).toBe(false);
    }
    expect(GetWorkflowRunOutputSchema.parse({ ...RUNNING, subagents: [] }).subagents).toEqual([]);
    expect(GetWorkflowRunOutputSchema.safeParse({ ...RUNNING, subagents: undefined }).success).toBe(false);
  });

  it("closes the subagent state and wait-cause enums", () => {
    for (const patch of [{ state: "thinking" }, { wait: { cause: "quota" } }]) {
      expect(
        GetWorkflowRunOutputSchema.safeParse({
          ...RUNNING,
          subagents: [{ ...RUNNING.subagents[0]!, ...patch }],
        }).success,
      ).toBe(false);
    }
  });

  it("bounds the roster at 64 rows and the phase table at 32", () => {
    const subagent = RUNNING.subagents[0]!;
    expect(
      GetWorkflowRunOutputSchema.safeParse({
        ...RUNNING,
        subagents: Array.from({ length: 65 }, () => subagent),
      }).success,
    ).toBe(false);
    const phase = { name: "p", state: "done" as const, rounds: 1, nodesSettled: 0, nodesRunning: 0 };
    expect(
      GetWorkflowRunOutputSchema.safeParse({ ...RUNNING, phases: Array.from({ length: 33 }, () => phase) }).success,
    ).toBe(false);
  });

  it("round-trips health, requires pendingQuestionsKnown and keeps concurrency optional", () => {
    const health = {
      lastProgressAt: 1_755_000_001_000,
      stalledSince: 1_755_000_000_800,
      concurrency: { effective: 2, cap: 3, reason: "rate_limited", since: 1_755_000_000_700 },
      consecutiveFailures: 1,
      cachedSteps: 4,
      leftoverRunning: 2,
      pendingQuestionsKnown: false,
    };
    expect(GetWorkflowRunOutputSchema.parse({ ...RUNNING, health }).health).toEqual(health);
    expect(
      GetWorkflowRunOutputSchema.safeParse({
        ...RUNNING,
        health: { consecutiveFailures: 0, cachedSteps: 0 },
      }).success,
    ).toBe(false);
    expect(
      GetWorkflowRunOutputSchema.safeParse({
        ...RUNNING,
        health: { ...RUNNING.health, leftoverRunning: 0 },
      }).success,
    ).toBe(false);
  });

  it("marks a clamped roster with a literal-true flag only", () => {
    expect(GetWorkflowRunOutputSchema.parse({ ...RUNNING, subagentsTruncated: true }).subagentsTruncated).toBe(true);
    expect(
      GetWorkflowRunOutputSchema.safeParse({ ...RUNNING, subagentsTruncated: false }).success,
    ).toBe(false);
  });

  it("bounds the summary at 400 characters", () => {
    expect(GetWorkflowRunOutputSchema.safeParse({ ...RUNNING, summary: "x".repeat(400) }).success).toBe(true);
    expect(GetWorkflowRunOutputSchema.safeParse({ ...RUNNING, summary: "x".repeat(401) }).success).toBe(false);
  });

  it("carries the primary flag on a published artifact as a literal true only", () => {
    const artifact = { id: "report", kind: "markdown" as const, version: 1, itemCount: 0 };
    const withPrimary = { ...RUNNING, artifacts: [{ ...artifact, primary: true as const }] };
    expect(GetWorkflowRunOutputSchema.parse(withPrimary)).toEqual(withPrimary);
    expect(GetWorkflowRunOutputSchema.parse({ ...RUNNING, artifacts: [artifact] })).toEqual({
      ...RUNNING,
      artifacts: [artifact],
    });
    // strict + literal: a non-deliverable is the absence of the key, never `false`.
    expect(
      GetWorkflowRunOutputSchema.safeParse({ ...RUNNING, artifacts: [{ ...artifact, primary: false }] })
        .success,
    ).toBe(false);
  });

  it("takes result as text only, never as a raw structure", () => {
    expect(
      GetWorkflowRunOutputSchema.safeParse({
        ...RUNNING,
        status: "completed",
        result: { verdict: "ship" },
      }).success,
    ).toBe(false);
  });

  it("projects the common cross-section into the model-facing JSON schema", () => {
    const schema = GetWorkflowRunOutputJsonSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {})).toEqual([
      "runId",
      "label",
      "labelSource",
      "status",
      "stopReason",
      "resumedFrom",
      "supersededBy",
      "ownedByThisSession",
      "possiblyInterrupted",
      "createdAt",
      "updatedAt",
      "summary",
      "generatedAt",
      "usage",
      "maxConcurrency",
      "subagentModel",
      "modelBindings",
      "scriptPath",
      "actors",
      "logTail",
      "phases",
      "subagents",
      "subagentsTruncated",
      "health",
      "result",
      "error",
      "pendingQuestions",
      "holes",
      "artifacts",
    ]);
    const required = schema.required ?? [];
    expect(required).toContain("usage");
    expect(required).toContain("logTail");
    expect(required).toContain("summary");
    expect(required).toContain("generatedAt");
    expect(required).toContain("subagents");
    expect(required).toContain("health");
    expect(required).not.toContain("phases");
    expect(required).not.toContain("subagentsTruncated");
    expect(required).not.toContain("result");
    expect(required).not.toContain("error");
    expect(required).not.toContain("possiblyInterrupted");
    expect(required).not.toContain("pendingQuestions");
    expect(required).not.toContain("scriptPath");
  });
});
