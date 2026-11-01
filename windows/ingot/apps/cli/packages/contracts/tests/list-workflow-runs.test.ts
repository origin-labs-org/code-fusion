import { describe, expect, it } from "vitest";
import {
  LIST_WORKFLOW_RUNS_TOOL_NAME,
  ListWorkflowRunsInputJsonSchema,
  ListWorkflowRunsInputSchema,
  ListWorkflowRunsOutputJsonSchema,
  ListWorkflowRunsOutputSchema,
  WORKFLOW_RUN_LIFECYCLE_STATUSES,
} from "../src/tools/list-workflow-runs.js";

const RUN = {
  runId: "dwfrun-1",
  label: "nightly triage",
  labelSource: "name" as const,
  status: "running" as const,
  ownedByThisSession: true,
  createdAt: 1_755_000_000_000,
  updatedAt: 1_755_000_001_000,
  spentTokens: 1_204,
};

describe("ListWorkflowRuns input schema", () => {
  it("names the tool exactly as it registers", () => {
    expect(LIST_WORKFLOW_RUNS_TOOL_NAME).toBe("ListWorkflowRuns");
  });

  it("defaults limit to 20 when the model omits it", () => {
    expect(ListWorkflowRunsInputSchema.parse({})).toEqual({ limit: 20 });
  });

  it("clamps an out-of-range limit into [1, 50] instead of rejecting it", () => {
    expect(ListWorkflowRunsInputSchema.parse({ limit: 0 }).limit).toBe(1);
    expect(ListWorkflowRunsInputSchema.parse({ limit: -7 }).limit).toBe(1);
    expect(ListWorkflowRunsInputSchema.parse({ limit: 500 }).limit).toBe(50);
    expect(ListWorkflowRunsInputSchema.parse({ limit: 7 }).limit).toBe(7);
    expect(ListWorkflowRunsInputSchema.parse({ limit: 12.5 }).limit).toBe(12);
  });

  it("still rejects a non-numeric limit", () => {
    for (const limit of ["many", null, {}]) {
      expect(ListWorkflowRunsInputSchema.safeParse({ limit }).success).toBe(false);
    }
  });

  it("accepts a status subset and rejects unknown status literals", () => {
    expect(ListWorkflowRunsInputSchema.parse({ statuses: ["errored", "running"] })).toEqual({
      limit: 20,
      statuses: ["errored", "running"],
    });
    expect(ListWorkflowRunsInputSchema.safeParse({ statuses: ["lost"] }).success).toBe(false);
    expect(ListWorkflowRunsInputSchema.safeParse({ statuses: ["failed"] }).success).toBe(false);
    expect(ListWorkflowRunsInputSchema.safeParse({ statuses: ["cancelled"] }).success).toBe(false);
    expect(ListWorkflowRunsInputSchema.parse({ statuses: [] }).statuses).toEqual([]);
  });

  it("stays strict about unknown keys", () => {
    expect(ListWorkflowRunsInputSchema.safeParse({ cwd: "/elsewhere" }).success).toBe(false);
  });

  it("publishes the bounds and the default to the model without requiring limit", () => {
    const schema = ListWorkflowRunsInputJsonSchema as {
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
    };
    expect(schema.properties?.limit).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 50,
      default: 20,
    });
    expect(schema.properties?.statuses?.type).toBe("array");
    expect(schema.required ?? []).toEqual([]);
  });
});

describe("ListWorkflowRuns output schema", () => {
  it("roundtrips a minimal run list", () => {
    const output = { runs: [RUN] };
    expect(ListWorkflowRunsOutputSchema.parse(output)).toEqual(output);
  });

  it("carries the optional annotations and the page-level truncation flag", () => {
    const output = {
      runs: [{ ...RUN, ownedByThisSession: false, possiblyInterrupted: true }],
      truncated: true,
    };
    expect(ListWorkflowRunsOutputSchema.parse(output)).toEqual(output);
  });

  it("omits possiblyInterrupted and truncated rather than defaulting them to false", () => {
    const parsed = ListWorkflowRunsOutputSchema.parse({ runs: [RUN] });
    expect("truncated" in parsed).toBe(false);
    expect("possiblyInterrupted" in parsed.runs[0]!).toBe(false);
  });

  it("accepts an empty project list", () => {
    expect(ListWorkflowRunsOutputSchema.parse({ runs: [] })).toEqual({ runs: [] });
  });

  it("keeps the lifecycle vocabulary aligned with the port", () => {
    expect([...WORKFLOW_RUN_LIFECYCLE_STATUSES]).toEqual([
      "completed",
      "errored",
      "pending",
      "running",
      "stopped",
    ]);
    for (const status of WORKFLOW_RUN_LIFECYCLE_STATUSES) {
      expect(ListWorkflowRunsOutputSchema.safeParse({ runs: [{ ...RUN, status }] }).success).toBe(
        true,
      );
    }
  });

  it("stays strict about unknown keys on the page and on a row", () => {
    expect(ListWorkflowRunsOutputSchema.safeParse({ runs: [RUN], cursor: "x" }).success).toBe(false);
    expect(
      ListWorkflowRunsOutputSchema.safeParse({ runs: [{ ...RUN, scriptText: "return 1;" }] })
        .success,
    ).toBe(false);
  });

  it("requires the label source to be one of the two derivations", () => {
    expect(
      ListWorkflowRunsOutputSchema.safeParse({ runs: [{ ...RUN, labelSource: "runId" }] }).success,
    ).toBe(false);
  });

  it("projects every row field into the model-facing JSON schema", () => {
    const rowProperties = (
      ListWorkflowRunsOutputJsonSchema as {
        properties?: { runs?: { items?: { properties?: Record<string, unknown> } } };
      }
    ).properties?.runs?.items?.properties;
    expect(Object.keys(rowProperties ?? {})).toEqual([
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
      "spentTokens",
    ]);
  });

  it("accepts the five stop reasons and rejects anything else", () => {
    for (const stopReason of ["user", "model", "provider", "interrupted", "superseded"]) {
      expect(
        ListWorkflowRunsOutputSchema.safeParse({
          runs: [{ ...RUN, status: "stopped", stopReason }],
        }).success,
      ).toBe(true);
    }
    expect(
      ListWorkflowRunsOutputSchema.safeParse({
        runs: [{ ...RUN, status: "stopped", stopReason: "crash" }],
      }).success,
    ).toBe(false);
  });
});
