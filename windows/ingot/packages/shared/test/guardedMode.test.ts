import { describe, expect, it } from "vitest";
import {
  getCfAgentAvailableModes,
  getCfAgentModeSelectOptions,
  normalizeAvailableCfMode,
} from "../src/cf-agent-model-state.js";
import { submissionModeSchema } from "../src/cf-protocol-v4/submission.js";
import { cfSessionModeSchema } from "../src/cf-protocol-legacy-types.js";
import { executionStateSchema, resolveExecutionState } from "../src/execution-state.js";

describe("guarded wire and mode catalog", () => {
  it("preserves guarded across independent Plan transitions and serialization", () => {
    const current = resolveExecutionState({ mode: "guarded", planEnabled: true });
    expect(executionStateSchema.parse(current)).toEqual({ mode: "guarded", planEnabled: true });
    expect(resolveExecutionState({ planEnabled: false }, current)).toEqual({
      mode: "guarded",
      planEnabled: false,
    });
  });
  it("round trips the opt-in value without changing the default", () => {
    expect(submissionModeSchema.parse("guarded")).toBe("guarded");
    expect(cfSessionModeSchema.parse("guarded")).toBe("guarded");
    expect(normalizeAvailableCfMode("guarded")).toBe("guarded");
    const ids = getCfAgentAvailableModes().map((mode) => mode.id);
    expect(ids).toEqual(["build", "guarded", "plan", "yolo"]);
    expect(getCfAgentModeSelectOptions().map((option) => option.value)).toEqual(ids);
    expect(submissionModeSchema.safeParse("unknown").success).toBe(false);
  });
  it("keeps historical edit valid without advertising it as a new choice", () => {
    expect(submissionModeSchema.parse("edit")).toBe("edit");
    expect(cfSessionModeSchema.parse("edit")).toBe("edit");
    expect(normalizeAvailableCfMode("edit")).toBe("edit");
    expect(getCfAgentAvailableModes().some((mode) => mode.id === "edit")).toBe(false);
  });
});
