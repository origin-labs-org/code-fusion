// ============================================================
// ============================================================

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DYNAMIC_WORKFLOW_SKILL_NAME } from "@origin-ai/cf-contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { amendWorkflowToolEntry } from "../src/tool/handlers/amend-workflow.js";
import { createWorkflowToolEntry } from "../src/tool/handlers/create-workflow.js";
import { evalWorkflowSnippetToolEntry } from "../src/tool/handlers/eval-workflow-snippet.js";
import { saveWorkflowToolEntry } from "../src/tool/handlers/save-workflow.js";
import {
  WORKFLOW_SKILL_NOT_LOADED_CODE,
  amendWorkflowNeedsSkill,
  createWorkflowNeedsSkill,
} from "../src/tool/handlers/workflow-skill-gate.js";
import type { ToolEntry, ToolInputResolutionContext } from "../src/tool/types.js";

const SCRIPT = "return 1;";

function contextWith(loaded: boolean | undefined, cwd: string): ToolInputResolutionContext {
  return {
    workingDirectory: cwd,
    ...(loaded === undefined
      ? {}
      : { hasLoadedSkill: (name: string) => loaded && name === DYNAMIC_WORKFLOW_SKILL_NAME }),
  };
}

async function resolve(entry: ToolEntry, input: unknown, context: ToolInputResolutionContext) {
  if (!entry.resolveInput) throw new Error(`${entry.metadata.name} has no resolveInput`);
  return entry.resolveInput(input, context);
}

describe("dynamic-workflow skill gate", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "cf-skill-gate-"));
  });
  afterEach(async () => {
    await rm(cwd, { force: true, recursive: true });
  });

  const authoringCalls: Array<{ entry: ToolEntry; input: unknown }> = [
    { entry: createWorkflowToolEntry, input: { name: "r", script: SCRIPT } },
    { entry: createWorkflowToolEntry, input: { name: "r", path: "draft.dwf.ts" } },
    { entry: amendWorkflowToolEntry, input: { run_id: "run_1", script: SCRIPT } },
    { entry: amendWorkflowToolEntry, input: { run_id: "run_1", path: "draft.dwf.ts" } },
    {
      entry: saveWorkflowToolEntry,
      input: { name: "nightly", description: "d", scope: "project", script: SCRIPT },
    },
    { entry: evalWorkflowSnippetToolEntry, input: { code: SCRIPT } },
  ];

  for (const { entry, input } of authoringCalls) {
    const label = `${entry.metadata.name} ${Object.keys(input as object).join("+")}`;

    it(`${label}: refuses before any resolution when the skill is not loaded`, async () => {
      const result = await resolve(entry, input, contextWith(false, cwd));
      expect(result).toMatchObject({
        result: false,
        errorCode: WORKFLOW_SKILL_NOT_LOADED_CODE,
      });
      const message = (result as { message: string }).message;
      expect(message).toContain(`"${DYNAMIC_WORKFLOW_SKILL_NAME}"`);
      expect(message).toContain("Skill tool");
      expect(message).toContain(entry.metadata.name);
      expect(message).toContain("Nothing was started");
    });

    it(`${label}: proceeds when the skill is loaded`, async () => {
      const result = await resolve(entry, input, contextWith(true, cwd));
      expect((result as { errorCode?: number }).errorCode).not.toBe(WORKFLOW_SKILL_NOT_LOADED_CODE);
    });

    it(`${label}: proceeds when the session has no probe (no Skill tool)`, async () => {
      const result = await resolve(entry, input, contextWith(undefined, cwd));
      expect((result as { errorCode?: number }).errorCode).not.toBe(WORKFLOW_SKILL_NOT_LOADED_CODE);
    });
  }

  it("CreateWorkflow: running a saved workflow by name needs no skill", async () => {
    const result = await resolve(
      createWorkflowToolEntry,
      { saved: { name: "nightly" } },
      contextWith(false, cwd),
    );
    expect((result as { errorCode?: number }).errorCode).not.toBe(WORKFLOW_SKILL_NOT_LOADED_CODE);
    expect(createWorkflowNeedsSkill({ saved: { name: "nightly" } })).toBe(false);
    expect(createWorkflowNeedsSkill({ saved: { name: "nightly" }, path: "x.dwf.ts" })).toBe(true);
    expect(createWorkflowNeedsSkill({ script: SCRIPT })).toBe(true);
    expect(createWorkflowNeedsSkill(undefined)).toBe(true);
  });

  it("AmendWorkflow: a settings-only call keeps the predecessor's script and needs no skill", async () => {
    const result = await resolve(
      amendWorkflowToolEntry,
      { run_id: "run_1", max_concurrency: 2 },
      contextWith(false, cwd),
    );
    expect((result as { errorCode?: number }).errorCode).not.toBe(WORKFLOW_SKILL_NOT_LOADED_CODE);
    expect(amendWorkflowNeedsSkill({ run_id: "run_1", subagent_model: null })).toBe(false);
    expect(amendWorkflowNeedsSkill({ run_id: "run_1", script: SCRIPT })).toBe(true);
    expect(amendWorkflowNeedsSkill({ run_id: "run_1", path: "a.dwf.ts" })).toBe(true);
  });
});
