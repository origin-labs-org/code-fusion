

import { describe, expect, it } from "vitest";
import type { ModelSelection } from "@origin-ai/cf-contracts";
import { InMemoryJournalStore } from "@origin-ai/cf-dynamic-workflow";
import {
  WorkflowActorModelUnboundError,
  WorkflowActorPinnedModelError,
  resolveActorPersonaModel,
  workflowActorModelPolicy,
} from "../src/app/workflow-actor-model.js";
import { workflowActorToolPolicy } from "../src/app/workflow-actor-tools.js";
import {
  journalActorResolvedModel,
  pinnedActorModel,
} from "../src/app/dynamic-workflow-run-launch.js";

function selection(providerId: string, modelId: string): ModelSelection {
  return { providerId, modelId };
}

const PARENT = selection("anthropic", "sonnet");
const OTHER = selection("anthropic", "haiku");

const RUN_CHOICE: ModelSelection = {
  providerId: "zhipu",
  modelId: "glm-5.3-flash",
  options: { reasoningLevel: "high" },
};

describe("workflowActorModelPolicy", () => {
  it("overrides nothing without a pin: the child inherits the parent session's current model", () => {
    expect(workflowActorModelPolicy({ parentSelection: PARENT }).configOverrides).toEqual({});
  });

  it("works without a parent selection at all (parent session not yet bound to a model)", () => {
    expect(workflowActorModelPolicy({}).configOverrides).toEqual({});
  });

  it("shares no config keys with the tool policy", () => {
    const model = workflowActorModelPolicy({ parentSelection: PARENT }, "anthropic/haiku");
    const overlap = Object.keys(workflowActorToolPolicy()).filter(
      (key) => key in model.configOverrides,
    );
    expect(overlap).toEqual([]);
  });
});

describe("workflowActorModelPolicy (run-level subagent model)", () => {
  it("no pin + a run selection: overrides with the whole selection, reasoning level included", () => {
    const policy = workflowActorModelPolicy({ parentSelection: PARENT, runSelection: RUN_CHOICE });
    expect(policy.configOverrides).toEqual({ modelSelection: RUN_CHOICE });
  });

  it("the run selection applies even when the parent session has no model of its own", () => {
    expect(workflowActorModelPolicy({ runSelection: RUN_CHOICE }).configOverrides).toEqual({
      modelSelection: RUN_CHOICE,
    });
  });

  it("a pin with the run selection's identity yields the run selection, not the pin", () => {
    const policy = workflowActorModelPolicy(
      { parentSelection: PARENT, runSelection: RUN_CHOICE },
      "zhipu/glm-5.3-flash",
    );
    expect(policy.configOverrides).toEqual({ modelSelection: RUN_CHOICE });
  });

  it("the run selection wins over a differing pin (the amend asked for the switch)", () => {
    const policy = workflowActorModelPolicy(
      { parentSelection: PARENT, runSelection: RUN_CHOICE },
      "openai/gpt-x",
    );
    expect(policy.configOverrides).toEqual({ modelSelection: RUN_CHOICE });
  });

  it("a pin equal to the parent model still yields the run selection", () => {
    const policy = workflowActorModelPolicy(
      { parentSelection: PARENT, runSelection: RUN_CHOICE },
      "anthropic/sonnet",
    );
    expect(policy.configOverrides).toEqual({ modelSelection: RUN_CHOICE });
  });

  it("with a run selection a malformed pin is never parsed: the run selection applies, no throw", () => {
    const policy = workflowActorModelPolicy(
      { parentSelection: PARENT, runSelection: RUN_CHOICE },
      "haiku",
    );
    expect(policy.configOverrides).toEqual({ modelSelection: RUN_CHOICE });
  });
});

describe("workflowActorModelPolicy (persona model)", () => {
  const ACTOR_CHOICE: ModelSelection = {
    providerId: "zhipu",
    modelId: "GLM-5.3",
    options: { reasoningLevel: "low" },
  };

  it("the persona's model wins over the run selection and a differing pin, whole", () => {
    expect(
      workflowActorModelPolicy(
        { parentSelection: PARENT, runSelection: RUN_CHOICE, actorSelection: ACTOR_CHOICE },
        "anthropic/haiku",
      ).configOverrides,
    ).toEqual({ modelSelection: ACTOR_CHOICE });
  });

  it("a malformed pin is never parsed when the persona names a model", () => {
    expect(() =>
      workflowActorModelPolicy({ actorSelection: ACTOR_CHOICE }, "no-provider-segment"),
    ).not.toThrow();
  });
});

describe("resolveActorPersonaModel", () => {
  const BINDINGS = { "GLM-5.3-Flash": "zhipu/GLM-5.3-Flash", "GLM-5.3$low": "zhipu/GLM-5.3$low" };

  it("looks the name up verbatim and returns the whole selection", () => {
    expect(resolveActorPersonaModel("GLM-5.3$low", BINDINGS)).toEqual({
      providerId: "zhipu",
      modelId: "GLM-5.3",
      options: { reasoningLevel: "low" },
    });
    expect(resolveActorPersonaModel("GLM-5.3-Flash", BINDINGS)).toEqual({
      providerId: "zhipu",
      modelId: "GLM-5.3-Flash",
    });
  });

  it("a persona without a model resolves to nothing (the run selection, pin or parent decide)", () => {
    expect(resolveActorPersonaModel(undefined, BINDINGS)).toBeUndefined();
    expect(resolveActorPersonaModel(undefined, undefined)).toBeUndefined();
  });

  it("an unbound name fails loudly, naming it and what the run did bind", () => {
    expect(() => resolveActorPersonaModel("glm-5.3-flash", BINDINGS)).toThrow(
      WorkflowActorModelUnboundError,
    );
    expect(() => resolveActorPersonaModel("x", undefined)).toThrow(/the script named no models/);
    expect(() => resolveActorPersonaModel("x", BINDINGS)).toThrow(
      /"GLM-5.3-Flash", "GLM-5.3\$low"/,
    );
  });
});

describe("workflowActorModelPolicy (resume pin)", () => {

  it("pin equal to the current parent model overrides nothing", () => {
    const policy = workflowActorModelPolicy({ parentSelection: PARENT }, "anthropic/sonnet");
    expect(policy.configOverrides).toEqual({});
  });

  it("pin comparison ignores the parent's reasoning options (identity is provider/model)", () => {
    const policy = workflowActorModelPolicy(
      { parentSelection: { ...PARENT, options: { reasoningLevel: "high" } } },
      "anthropic/sonnet",
    );
    expect(policy.configOverrides).toEqual({});
  });

  it("pins a model that is not the current parent model (no run selection: the pin is the default)", () => {
    const policy = workflowActorModelPolicy({ parentSelection: PARENT }, "openai/gpt-x");
    expect(policy.configOverrides.modelSelection).toEqual({
      providerId: "openai",
      modelId: "gpt-x",
    });
    expect(workflowActorModelPolicy({}, "anthropic/haiku").configOverrides).toEqual({
      modelSelection: OTHER,
    });
  });

  it("a malformed pin fails loudly instead of falling back to the parent model", () => {
    expect(() => workflowActorModelPolicy({ parentSelection: PARENT }, "haiku")).toThrow(
      WorkflowActorPinnedModelError,
    );
  });
});

describe("pinnedActorModel", () => {
  const RUN = "dwfrun-pin";
  const ACTOR = { siteId: "actor#1", ordinal: 1 };

  it("returns the journaled resolvedModel when a previous run recorded one", () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    journal.putActor({
      runId: RUN,
      siteId: ACTOR.siteId,
      ordinal: ACTOR.ordinal,
      persona: { name: "judge" },
      resolvedModel: "anthropic/haiku",
    });
    expect(pinnedActorModel({ actor: ACTOR, journal, runId: RUN })).toBe("anthropic/haiku");
  });

  it("is undefined for a fresh actor record and for a missing record", () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    journal.putActor({
      runId: RUN,
      siteId: ACTOR.siteId,
      ordinal: ACTOR.ordinal,
      persona: { name: "judge" },
    });
    expect(pinnedActorModel({ actor: ACTOR, journal, runId: RUN })).toBeUndefined();
    expect(
      pinnedActorModel({ actor: { siteId: "actor#9", ordinal: 1 }, journal, runId: RUN }),
    ).toBeUndefined();
  });
});

describe("journalActorResolvedModel", () => {
  const RUN = "dwfrun-1";
  const ACTOR = { siteId: "actor#1", ordinal: 1 };

  function journalWithActor() {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    journal.putActor({
      runId: RUN,
      siteId: ACTOR.siteId,
      ordinal: ACTOR.ordinal,
      name: "judge",
      persona: { name: "judge" },
    });
    return journal;
  }

  it("records the model the runtime actually got, without touching the frozen persona", () => {
    const journal = journalWithActor();
    journalActorResolvedModel({ actor: ACTOR, journal, selection: OTHER, runId: RUN });

    expect(journal.getActor(RUN, ACTOR.siteId, ACTOR.ordinal)).toEqual({
      runId: RUN,
      siteId: ACTOR.siteId,
      ordinal: ACTOR.ordinal,
      name: "judge",
      persona: { name: "judge" },
      resolvedModel: "anthropic/haiku",
    });
  });

  it("records the parent model verbatim on the no-override path", () => {
    const journal = journalWithActor();
    journalActorResolvedModel({ actor: ACTOR, journal, selection: PARENT, runId: RUN });

    expect(journal.getActor(RUN, ACTOR.siteId, ACTOR.ordinal)?.resolvedModel).toBe(
      "anthropic/sonnet",
    );
  });

  it("keeps a sessionId written earlier by the driver", () => {
    const journal = journalWithActor();
    const existing = journal.getActor(RUN, ACTOR.siteId, ACTOR.ordinal)!;
    journal.putActor({ ...existing, sessionId: "ses_actor" });
    journalActorResolvedModel({ actor: ACTOR, journal, selection: OTHER, runId: RUN });

    expect(journal.getActor(RUN, ACTOR.siteId, ACTOR.ordinal)).toMatchObject({
      sessionId: "ses_actor",
      resolvedModel: "anthropic/haiku",
      persona: { name: "judge" },
    });
  });
});
