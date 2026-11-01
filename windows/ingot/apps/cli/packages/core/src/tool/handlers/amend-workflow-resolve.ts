// ============================================================
// ============================================================
//

import {
  AmendWorkflowInputSchema,
  type AmendWorkflowInput,
  type ModelCatalogPort,
} from "@origin-ai/cf-contracts";
import type {
  ToolHandlerFailure,
  ToolInputResolutionContext,
  ToolInputResolutionResult,
} from "../types.js";
import { SUBAGENT_MODEL_UNAVAILABLE } from "./create-workflow-source.js";
import { resolveConcurrencyRetuneRoute } from "./amend-workflow-retune.js";
import {
  AMEND_WORKFLOW_ERROR_CODE,
  describePredecessor,
  refuseUnchangedScript,
  resolveAmendMaxConcurrency,
  resolveAmendScript,
} from "./amend-workflow-source.js";
import { resolveModelReference } from "./model-reference.js";
import { withScriptModelBindings } from "./workflow-script-models.js";
import { workflowRunNotFoundFailure } from "./workflow-run-introspection.js";

export {
  AMEND_WORKFLOW_ERROR_CODE,
  resolveAmendMaxConcurrency,
  scriptUnavailableFailure,
  validateAmendWorkflowSource,
} from "./amend-workflow-source.js";

const CANONICAL_PROVIDER_SEPARATOR = "/";

export function predecessorNotFoundFailure(runId: string): ToolHandlerFailure {
  const base = workflowRunNotFoundFailure(runId);
  return {
    ...base,
    message: `${base.message} Nothing was stopped or created: \`run_id\` pointed at a run that does not exist — pass an existing run's ID (see ListWorkflowRuns), or start a fresh run with CreateWorkflow.`,
  };
}

export async function resolveAmendWorkflowInput(
  input: unknown,
  context: ToolInputResolutionContext,
): Promise<ToolInputResolutionResult> {
  const parsed = AmendWorkflowInputSchema.safeParse(input);
  if (!parsed.success) return { result: true, input };
  const cwd = context.workingDirectory ?? ".";
  const port = context.dynamicWorkflowRunPort;
  if (port === undefined) {
    const {
      predecessor: _forged,
      max_concurrency: requested,
      subagent_model: _model,
      script_line_offset: _offset,
      ...rest
    } = parsed.data;
    void _forged;
    void _model;
    void _offset;
    const subagentModel = resolveAmendSubagentModel(
      parsed.data.subagent_model,
      undefined,
      context.modelCatalogPort,
    );
    if (!subagentModel.result) return subagentModel;
    const script = await resolveAmendScript({
      model: parsed.data,
      cwd,
      port,
      predecessorScriptPath: undefined,
    });
    if (!script.result) return script;
    return {
      result: true,
      input: withScriptModelBindings(
        {
          ...rest,
          ...script.fields,
          ...(typeof requested === "number" ? { max_concurrency: requested } : {}),
          ...subagentModel.field,
        },
        context.modelCatalogPort,
      ),
    };
  }
  const snapshot = await port.getTask(parsed.data.run_id);
  if (snapshot === undefined) return predecessorNotFoundFailure(parsed.data.run_id);
  const predecessor = describePredecessor(snapshot, context.sessionId);
  const retune = resolveConcurrencyRetuneRoute({
    model: parsed.data,
    port,
    predecessor,
    inherited: snapshot.maxConcurrency,
  });
  if (retune !== undefined) return retune;
  const subagentModel = resolveAmendSubagentModel(
    parsed.data.subagent_model,
    snapshot.subagentModel,
    context.modelCatalogPort,
  );
  if (!subagentModel.result) return subagentModel;
  const script = await resolveAmendScript({
    model: parsed.data,
    cwd,
    port,
    predecessorScriptPath: snapshot.scriptPath,
  });
  if (!script.result) return script;
  const unchanged = await refuseUnchangedScript({
    port,
    model: parsed.data,
    resolvedScript: script.fields.script,
    described: script.described,
  });
  if (unchanged !== undefined) return unchanged;
  const {
    predecessor: _forged,
    max_concurrency: _tristate,
    subagent_model: _model,
    script_line_offset: _offset,
    ...rest
  } = parsed.data;
  void _forged;
  void _model;
  void _offset;
  const resolved: AmendWorkflowInput = {
    ...rest,
    ...script.fields,
    ...resolveAmendMaxConcurrency(parsed.data.max_concurrency, snapshot.maxConcurrency),
    ...subagentModel.field,
    predecessor: {
      ...predecessor,
      ...(script.inherited ? { script_inherited: true as const } : {}),
    },
  };
  const bound = withScriptModelBindings(resolved, context.modelCatalogPort, snapshot.modelBindings);
  const introduced = introducedProviders(bound, snapshot, context.modelCatalogPort);
  return {
    result: true,
    input:
      introduced.length === 0
        ? bound
        : {
            ...bound,
            predecessor: { ...resolved.predecessor, introduces_providers: introduced },
          },
  };
}

function introducedProviders(
  input: Record<string, unknown>,
  snapshot: { subagentModel?: string; modelBindings?: Record<string, string> },
  catalog: ModelCatalogPort | undefined,
): string[] {
  const used = new Set<string>();
  const sessionProvider = catalog?.listModels().find((entry) => entry.current)?.providerId;
  if (sessionProvider !== undefined) used.add(sessionProvider);
  for (const model of [snapshot.subagentModel, ...Object.values(snapshot.modelBindings ?? {})]) {
    const provider = providerOfCanonical(model);
    if (provider !== undefined) used.add(provider);
  }
  const bindings = input.model_bindings;
  const next = [
    input.subagent_model,
    ...(typeof bindings === "object" && bindings !== null ? Object.values(bindings) : []),
  ];
  const introduced = new Set<string>();
  for (const model of next) {
    const provider = providerOfCanonical(model);
    if (provider !== undefined && !used.has(provider)) introduced.add(provider);
  }
  return [...introduced].sort();
}

function providerOfCanonical(model: unknown): string | undefined {
  if (typeof model !== "string") return undefined;
  const separator = model.indexOf(CANONICAL_PROVIDER_SEPARATOR);
  return separator > 0 ? model.slice(0, separator) : undefined;
}

function resolveAmendSubagentModel(
  requested: string | null | undefined,
  inherited: string | undefined,
  catalog: ModelCatalogPort | undefined,
): { result: true; field: { subagent_model?: string } } | ToolHandlerFailure {
  const choice = resolveAmendSubagentModelChoice(requested, inherited, catalog);
  if (choice.ok) {
    return {
      result: true,
      field: choice.canonical === undefined ? {} : { subagent_model: choice.canonical },
    };
  }
  return subagentModelFailure(
    choice.inherited
      ? `This amend inherited the predecessor run's subagent model (\`${choice.text}\`), which is no longer usable. ${choice.message}\n\nPass \`subagent_model: null\` to run the revision on the session model instead.`
      : choice.message,
  );
}

export function resolveAmendSubagentModelChoice(
  requested: string | null | undefined,
  inherited: string | undefined,
  catalog: ModelCatalogPort | undefined,
):
  | { ok: true; canonical?: string }
  | { ok: false; inherited: boolean; text: string; message: string } {
  if (requested === null) return { ok: true };
  const text = requested ?? inherited;
  if (text === undefined) return { ok: true };
  if (catalog === undefined) {
    return requested === undefined
      ? { ok: true, canonical: text }
      : { ok: false, inherited: false, text, message: SUBAGENT_MODEL_UNAVAILABLE };
  }
  const resolution = resolveModelReference(text, catalog.listModels());
  if (!resolution.ok) {
    return { ok: false, inherited: requested === undefined, text, message: resolution.message };
  }
  return { ok: true, canonical: resolution.canonical };
}

function subagentModelFailure(message: string): ToolHandlerFailure {
  return {
    result: false,
    errorCode: AMEND_WORKFLOW_ERROR_CODE.SUBAGENT_MODEL,
    message: `workflow_subagent_model_unresolved: ${message} Nothing was stopped or created.`,
  };
}
