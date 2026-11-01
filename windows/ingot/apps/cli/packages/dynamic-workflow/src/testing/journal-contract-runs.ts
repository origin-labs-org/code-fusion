

import { expect, it } from "vitest";
import type { JournalStorePort } from "../engine/index.js";
import { baseRun } from "./journal-contract-helpers.js";

export function registerRunCases(factory: () => JournalStorePort): void {
  it("creates and reads back a run record", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    expect(store.getRun("r1")).toMatchObject({ runId: "r1", status: "running", spentTokens: 0 });
    expect(store.getRun("missing")).toBeUndefined();
  });

  it("rejects duplicate run creation loudly", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    expect(() => store.createRun(baseRun("r1"))).toThrow();
  });

  it("updates run status and failure", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "errored", {
      failure: { code: "ReportCapExceeded", message: "cap" },
    });
    const run = store.getRun("r1");
    expect(run?.status).toBe("errored");
    expect(run?.failure).toEqual({ code: "ReportCapExceeded", message: "cap" });
    expect(run?.stopReason).toBeUndefined();
  });

  it("settles a stopped run with its reason and a ProviderStop failure", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    const failure = {
      code: "ProviderStop" as const,
      message: "Sign-in to BigModel expired.",
      providerStop: {
        kind: "auth" as const,
        reason: "auth_failed",
        providerId: "account:bigmodel-coding-plan",
        modelId: "GLM-5.3",
        providerCode: "1006",
        subagent: "verify@2",
        phase: "Verify",
        rawMessage: "[1006] token expired",
      },
    };
    store.updateRunStatus("r1", "stopped", { stopReason: "provider", failure });
    const run = store.getRun("r1");
    expect(run?.status).toBe("stopped");
    expect(run?.stopReason).toBe("provider");
    expect(run?.failure).toEqual(failure);
    expect(run?.result).toBeUndefined();
  });

  it("settles a stopped run without a failure and reads the reason back", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "stopped", { stopReason: "model" });
    const run = store.getRun("r1");
    expect(run?.status).toBe("stopped");
    expect(run?.stopReason).toBe("model");
    expect(run?.failure).toBeUndefined();
  });

  it("settles an interrupted run with its Interrupted failure", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "stopped", {
      stopReason: "interrupted",
      failure: { code: "Interrupted", message: "owner process exited" },
    });
    const run = store.getRun("r1");
    expect(run?.status).toBe("stopped");
    expect(run?.stopReason).toBe("interrupted");
    expect(run?.failure?.code).toBe("Interrupted");
  });

  it("settles a completed run together with its artifact", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "completed", { result: { answer: 42, notes: ["a", "b"] } });
    const run = store.getRun("r1");
    expect(run?.status).toBe("completed");
    expect(run?.result).toEqual({ answer: 42, notes: ["a", "b"] });
    expect(run?.failure).toBeUndefined();
  });

  it.each([
    ["a string artifact", "plain text answer"],
    ["an array artifact", [1, "two", { three: true }]],
    ["a number artifact", 7],
    ["a boolean artifact", false],
    ["a null artifact", null],
  ])("round-trips %s", (_label, artifact) => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "completed", { result: artifact });
    const run = store.getRun("r1");
    expect(run?.status).toBe("completed");
    expect("result" in (run ?? {})).toBe(true);
    expect(run?.result).toEqual(artifact);
  });

  it("leaves result absent for an errored settlement", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "errored", { failure: { code: "DriverError", message: "boom" } });
    const run = store.getRun("r1");
    expect(run?.status).toBe("errored");
    expect(run?.failure).toEqual({ code: "DriverError", message: "boom" });
    expect(run?.result).toBeUndefined();
  });

  it("leaves result absent when no settlement bag is passed", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "completed");
    expect(store.getRun("r1")!.result).toBeUndefined();
    expect(store.getRun("r1")?.status).toBe("completed");
  });

  it("clears a stale failure when a later settlement completes the run", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "stopped", {
      stopReason: "interrupted",
      failure: { code: "Interrupted", message: "foreign reconcile" },
    });
    store.updateRunStatus("r1", "completed", { result: { done: true } });
    const run = store.getRun("r1");
    expect(run?.status).toBe("completed");
    expect(run?.failure).toBeUndefined();
    expect(run?.stopReason).toBeUndefined();
    expect(run?.result).toEqual({ done: true });
  });

  it("clears an errored failure when a later settlement completes the run", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "errored", { failure: { code: "DriverError", message: "boom" } });
    store.updateRunStatus("r1", "completed", { result: { done: true } });
    const run = store.getRun("r1");
    expect(run?.status).toBe("completed");
    expect(run?.failure).toBeUndefined();
    expect(run?.result).toEqual({ done: true });
  });

  it("keeps an already-settled artifact when a later write omits it", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "completed", { result: { kept: true } });
    store.updateRunStatus("r1", "completed");
    expect(store.getRun("r1")!.result).toEqual({ kept: true });
  });

  it("round-trips stopped(superseded) together with supersededBy", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "stopped", { stopReason: "superseded", supersededBy: "r2" });
    const run = store.getRun("r1");
    expect(run?.status).toBe("stopped");
    expect(run?.stopReason).toBe("superseded");
    expect(run?.supersededBy).toBe("r2");
    expect(run?.failure).toBeUndefined();
    store.createRun(baseRun("r3"));
    store.updateRunStatus("r3", "stopped", { stopReason: "model" });
    expect(store.getRun("r3")?.supersededBy).toBeUndefined();
  });

  it("clears failure and stopReason when flipping a stopped run back to a non-terminal status", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "stopped", {
      stopReason: "interrupted",
      failure: { code: "Interrupted", message: "killed" },
    });
    store.updateRunStatus("r1", "running");
    const run = store.getRun("r1");
    expect(run?.status).toBe("running");
    expect(run?.failure).toBeUndefined();
    expect(run?.stopReason).toBeUndefined();
    expect(run?.supersededBy).toBeUndefined();
  });

  it("clears result when flipping a completed run back to a non-terminal status", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "completed", { result: { stale: true } });
    store.updateRunStatus("r1", "pending");
    const run = store.getRun("r1");
    expect(run?.status).toBe("pending");
    expect(run?.result).toBeUndefined();
  });

  it("ignores a settlement bag on a non-terminal write (cleared, not stored)", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunStatus("r1", "running", { failure: { code: "DriverError", message: "x" } });
    expect(store.getRun("r1")?.failure).toBeUndefined();
  });

  it("creates and reads back a run carrying an artifact", () => {
    const store = factory();
    store.createRun({ ...baseRun("r1"), status: "completed", result: { seeded: true } });
    expect(store.getRun("r1")!.result).toEqual({ seeded: true });
  });

  it("round-trips a run name and keeps it absent when unnamed", () => {
    const store = factory();
    store.createRun({ ...baseRun("named"), name: "nightly triage" });
    store.createRun(baseRun("unnamed"));

    expect(store.getRun("named")?.name).toBe("nightly triage");
    const unnamed = store.getRun("unnamed");
    expect(unnamed?.name).toBeUndefined();
    expect(unnamed !== undefined && "name" in unnamed).toBe(false);
  });

  it("round-trips the run args and keeps them absent when the run had none", () => {
    const store = factory();
    store.createRun({
      ...baseRun("with-args"),
      args: { target: "packages/core", depth: 3, nested: { deep: true } },
    });
    store.createRun(baseRun("no-args"));

    expect(store.getRun("with-args")?.args).toEqual({
      target: "packages/core",
      depth: 3,
      nested: { deep: true },
    });
    const bare = store.getRun("no-args");
    expect(bare?.args).toBeUndefined();
    expect(bare !== undefined && "args" in bare).toBe(false);
  });

  it("keeps the run args across a status settlement", () => {
    const store = factory();
    store.createRun({ ...baseRun("r-args"), args: { keep: "me" } });
    store.updateRunStatus("r-args", "completed", { result: "done" });
    expect(store.getRun("r-args")?.args).toEqual({ keep: "me" });
  });

  it("keeps the run name across a status settlement", () => {
    const store = factory();
    store.createRun({ ...baseRun("r1"), name: "keeps its name" });
    store.updateRunStatus("r1", "completed", { result: "done" });
    expect(store.getRun("r1")?.name).toBe("keeps its name");
  });

  it("round-trips the originating toolCallId and keeps it absent when not given", () => {
    const store = factory();
    store.createRun({ ...baseRun("anchored"), toolCallId: "call-42" });
    store.createRun(baseRun("bare"));

    expect(store.getRun("anchored")?.toolCallId).toBe("call-42");
    const bare = store.getRun("bare");
    expect(bare?.toolCallId).toBeUndefined();
    expect(bare !== undefined && "toolCallId" in bare).toBe(false);
  });

  it("keeps the toolCallId across a status settlement and across a resume flip", () => {
    const store = factory();
    store.createRun({ ...baseRun("r1"), toolCallId: "call-7" });
    store.updateRunStatus("r1", "stopped", { stopReason: "user" });
    expect(store.getRun("r1")?.toolCallId).toBe("call-7");
    store.updateRunStatus("r1", "running");
    expect(store.getRun("r1")?.toolCallId).toBe("call-7");
  });

  it("round-trips the resumedFrom lineage pointer and keeps it absent for a fresh run", () => {
    const store = factory();
    store.createRun({ ...baseRun("amended"), resumedFrom: "run-predecessor" });
    store.createRun(baseRun("fresh"));

    expect(store.getRun("amended")?.resumedFrom).toBe("run-predecessor");
    const fresh = store.getRun("fresh");
    expect(fresh?.resumedFrom).toBeUndefined();
    expect(fresh !== undefined && "resumedFrom" in fresh).toBe(false);
  });

  it("keeps resumedFrom across a status settlement and across a resume flip", () => {
    const store = factory();
    store.createRun({ ...baseRun("r1"), resumedFrom: "run-a" });
    store.updateRunStatus("r1", "stopped", { stopReason: "user" });
    expect(store.getRun("r1")?.resumedFrom).toBe("run-a");
    store.updateRunStatus("r1", "running");
    expect(store.getRun("r1")?.resumedFrom).toBe("run-a");
  });

  it("isolates a stored artifact from later mutation of the caller's object", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    const artifact = { nested: { value: 1 } };
    store.updateRunStatus("r1", "completed", { result: artifact });
    artifact.nested.value = 999;
    expect((store.getRun("r1")!.result as { nested: { value: number } }).nested.value).toBe(1);
  });

  it("settles an artifact and a failure independently on separate runs", () => {
    const store = factory();
    store.createRun(baseRun("ok"));
    store.createRun(baseRun("bad"));
    store.updateRunStatus("ok", "completed", { result: "done" });
    store.updateRunStatus("bad", "errored", {
      failure: { code: "DriverError", message: "stop" },
    });
    expect(store.getRun("ok")?.result).toBe("done");
    expect(store.getRun("ok")?.failure).toBeUndefined();
    expect(store.getRun("bad")?.result).toBeUndefined();
    expect(store.getRun("bad")?.failure?.code).toBe("DriverError");
  });

  it("throws when updating an unknown run", () => {
    const store = factory();
    expect(() => store.updateRunStatus("nope", "completed")).toThrow();
  });

  it("persists accumulated usage without disturbing status or failure", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunUsage("r1", 4200);
    expect(store.getRun("r1")).toMatchObject({ spentTokens: 4200, status: "running" });
    expect(store.getRun("r1")?.failure).toBeUndefined();

    store.updateRunStatus("r1", "errored", {
      failure: { code: "DriverError", message: "over" },
    });
    store.updateRunUsage("r1", 5100);
    const run = store.getRun("r1");
    expect(run?.spentTokens).toBe(5100);
    expect(run?.status).toBe("errored");
    expect(run?.failure).toEqual({ code: "DriverError", message: "over" });
  });

  it("throws when updating the usage of an unknown run", () => {
    const store = factory();
    expect(() => store.updateRunUsage("nope", 1)).toThrow();
  });

  it("retunes the concurrency cap without disturbing status, usage or failure", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.updateRunUsage("r1", 4200);
    store.updateRunCaps("r1", { maxConcurrency: 2 });
    expect(store.getRun("r1")).toMatchObject({
      caps: { maxConcurrency: 2 },
      spentTokens: 4200,
      status: "running",
    });

    store.updateRunStatus("r1", "errored", {
      failure: { code: "DriverError", message: "over" },
    });
    store.updateRunCaps("r1", { maxConcurrency: 7 });
    const run = store.getRun("r1");
    expect(run?.caps).toEqual({ maxConcurrency: 7 });
    expect(run?.status).toBe("errored");
    expect(run?.failure).toEqual({ code: "DriverError", message: "over" });
  });

  it("throws when retuning the caps of an unknown run", () => {
    const store = factory();
    expect(() => store.updateRunCaps("nope", { maxConcurrency: 1 })).toThrow();
  });
}
