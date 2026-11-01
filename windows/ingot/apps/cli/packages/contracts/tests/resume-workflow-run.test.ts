import { describe, expect, it } from "vitest";
import {
  RESUME_WORKFLOW_RUN_TOOL_NAME,
  ResumeWorkflowRunInputJsonSchema,
  ResumeWorkflowRunInputSchema,
  ResumeWorkflowRunOutputJsonSchema,
  ResumeWorkflowRunOutputSchema,
} from "../src/tools/resume-workflow-run.js";

const BACKGROUNDED = {
  ok: true,
  runId: "dwfrun-1",
  response: "The workflow run resumed in the background with ID: dwfrun-1.",
  status: "backgrounded" as const,
  backgroundTaskId: "dwfrun-1",
};

describe("ResumeWorkflowRun input schema", () => {
  it("names the tool exactly as it registers", () => {
    expect(RESUME_WORKFLOW_RUN_TOOL_NAME).toBe("ResumeWorkflowRun");
  });

  it("requires a non-empty snake_case run_id", () => {
    expect(ResumeWorkflowRunInputSchema.parse({ run_id: "dwfrun-1" })).toEqual({
      run_id: "dwfrun-1",
    });
    expect(ResumeWorkflowRunInputSchema.safeParse({ run_id: "" }).success).toBe(false);
    expect(ResumeWorkflowRunInputSchema.safeParse({}).success).toBe(false);
    expect(ResumeWorkflowRunInputSchema.safeParse({ runId: "dwfrun-1" }).success).toBe(false);
  });

  it("stays strict about unknown keys", () => {
    expect(
      ResumeWorkflowRunInputSchema.safeParse({ run_id: "dwfrun-1", force: true }).success,
    ).toBe(false);
  });

  it("requires run_id as the only property in the model-facing JSON schema", () => {
    const schema = ResumeWorkflowRunInputJsonSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {})).toEqual(["run_id"]);
    expect(schema.required).toEqual(["run_id"]);
  });
});

describe("ResumeWorkflowRun output schema", () => {
  it("roundtrips the backgrounded success shape", () => {
    const parsed = ResumeWorkflowRunOutputSchema.parse(BACKGROUNDED);
    expect(parsed).toEqual(BACKGROUNDED);
  });

  it("requires every field of the success shape — there is no failure variant here", () => {
    expect(ResumeWorkflowRunOutputSchema.safeParse({ ...BACKGROUNDED, status: "completed" }).success).toBe(
      false,
    );
    expect(
      ResumeWorkflowRunOutputSchema.safeParse({ ...BACKGROUNDED, backgroundTaskId: "" }).success,
    ).toBe(false);
    expect(ResumeWorkflowRunOutputSchema.safeParse({ ok: true, runId: "dwfrun-1" }).success).toBe(
      false,
    );
  });

  it("stays strict about unknown keys", () => {
    expect(ResumeWorkflowRunOutputSchema.safeParse({ ...BACKGROUNDED, extra: 1 }).success).toBe(
      false,
    );
  });

  it("projects the success shape into the model-facing JSON schema", () => {
    const schema = ResumeWorkflowRunOutputJsonSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {})).toEqual([
      "ok",
      "runId",
      "response",
      "status",
      "backgroundTaskId",
    ]);
    expect(schema.required).toEqual(["ok", "runId", "response", "status", "backgroundTaskId"]);
  });
});
