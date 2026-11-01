import { describe, expect, it } from "vitest";
import {
  AMEND_WORKFLOW_TOOL_NAME,
  AmendWorkflowInputJsonSchema,
  AmendWorkflowInputSchema,
  isAmendWorkflowOwnedPredecessor,
} from "../src/tools/amend-workflow.js";

describe("AmendWorkflowInputSchema", () => {
  const SCRIPT = 'return await agent("a").ask<string>("go");';

  it("names the tool and accepts the model-facing shape", () => {
    expect(AMEND_WORKFLOW_TOOL_NAME).toBe("AmendWorkflow");
    const input = { run_id: "dwfrun-prev", script: SCRIPT };
    expect(AmendWorkflowInputSchema.parse(input)).toEqual(input);
    expect(AmendWorkflowInputSchema.parse({ ...input, name: "second pass" })).toEqual({
      ...input,
      name: "second pass",
    });
  });

  it("accepts the resolved predecessor block and rejects a malformed one", () => {
    const resolved = {
      run_id: "dwfrun-prev",
      script: SCRIPT,
      predecessor: { name: "triage", status: "running", owned_by_this_session: true },
    };
    expect(AmendWorkflowInputSchema.parse(resolved)).toEqual(resolved);
    expect(
      AmendWorkflowInputSchema.safeParse({
        ...resolved,
        predecessor: { status: "stopped", stop_reason: "superseded", owned_by_this_session: false },
      }).success,
    ).toBe(true);
    expect(
      AmendWorkflowInputSchema.safeParse({ ...resolved, predecessor: { status: "flying" } })
        .success,
    ).toBe(false);
  });

  it("accepts script_inherited on the resolved predecessor, only as true", () => {
    const resolved = {
      run_id: "dwfrun-prev",
      script: SCRIPT,
      predecessor: { status: "completed", owned_by_this_session: true, script_inherited: true },
    };
    expect(AmendWorkflowInputSchema.parse(resolved)).toEqual(resolved);
    expect(
      AmendWorkflowInputSchema.safeParse({
        ...resolved,
        predecessor: { ...resolved.predecessor, script_inherited: false },
      }).success,
    ).toBe(false);
  });

  it("accepts introduces_providers on the resolved predecessor and lets it end the exemption", () => {
    const owned = { status: "completed" as const, owned_by_this_session: true };
    const resolved = {
      run_id: "dwfrun-prev",
      script: SCRIPT,
      predecessor: { ...owned, introduces_providers: ["openai"] },
    };
    expect(AmendWorkflowInputSchema.parse(resolved)).toEqual(resolved);
    expect(
      AmendWorkflowInputSchema.safeParse({
        ...resolved,
        predecessor: { ...owned, introduces_providers: [] },
      }).success,
    ).toBe(false);
    expect(isAmendWorkflowOwnedPredecessor(owned)).toBe(true);
    expect(isAmendWorkflowOwnedPredecessor(resolved.predecessor)).toBe(false);
  });

  it("accepts the three states of subagent_model and rejects a blank string", () => {
    const input = { run_id: "dwfrun-prev", script: SCRIPT };
    expect(AmendWorkflowInputSchema.parse({ ...input, subagent_model: null })).toEqual({
      ...input,
      subagent_model: null,
    });
    expect(
      AmendWorkflowInputSchema.parse({ ...input, subagent_model: "  zhipu/glm-5.3  " }),
    ).toEqual({ ...input, subagent_model: "zhipu/glm-5.3" });
    expect(AmendWorkflowInputSchema.safeParse({ ...input, subagent_model: "   " }).success).toBe(
      false,
    );
  });

  it("requires run_id, leaves script optional, and rejects the legacy resume_from spelling", () => {
    expect(AmendWorkflowInputSchema.safeParse({ script: SCRIPT }).success).toBe(false);
    expect(AmendWorkflowInputSchema.parse({ run_id: "dwfrun-prev" })).toEqual({
      run_id: "dwfrun-prev",
    });
    expect(AmendWorkflowInputSchema.parse({ run_id: "dwfrun-prev", max_concurrency: 2 })).toEqual({
      run_id: "dwfrun-prev",
      max_concurrency: 2,
    });
    expect(AmendWorkflowInputSchema.safeParse({ run_id: "dwfrun-prev", script: "" }).success).toBe(
      false,
    );
    expect(AmendWorkflowInputSchema.safeParse({ run_id: "", script: SCRIPT }).success).toBe(false);
    expect(
      AmendWorkflowInputSchema.safeParse({
        run_id: "dwfrun-prev",
        script: SCRIPT,
        resume_from: "x",
      }).success,
    ).toBe(false);
  });

  it("takes the revision either inline or as a file, and carries the resolved line offset", () => {
    const byPath = { run_id: "dwfrun-prev", path: ".cf/workflow-drafts/x.dwf.ts" };
    expect(AmendWorkflowInputSchema.parse(byPath)).toEqual(byPath);
    const resolved = { ...byPath, script: SCRIPT, script_line_offset: 4 };
    expect(AmendWorkflowInputSchema.parse(resolved)).toEqual(resolved);
    expect(AmendWorkflowInputSchema.safeParse({ ...byPath, script_line_offset: -1 }).success).toBe(
      false,
    );
  });

  it("keeps predecessor out of the model-facing JSON schema", () => {
    const schema = AmendWorkflowInputJsonSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    // （docs/dynamic-workflow/concurrency.md「Two bounds on a run」、docs/dynamic-workflow/launch.md）；
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      "max_concurrency",
      "name",
      "path",
      "run_id",
      "script",
      "subagent_model",
    ]);
    expect(schema.required).toEqual(["run_id"]);
    expect(schema.additionalProperties).toBe(false);
  });
});
