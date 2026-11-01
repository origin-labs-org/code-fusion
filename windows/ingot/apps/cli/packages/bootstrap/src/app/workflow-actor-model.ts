// ============================================================
// ============================================================
//
//
//

import type { ModelSelection } from "@origin-ai/cf-shared/model-selection";
import { parseModelPickerValue } from "@origin-ai/cf-shared/model-selection";
import { parseProviderQualifiedModelSelection } from "./provider-registry-selection.js";

interface WorkflowActorModelHost {
  
  parentSelection?: ModelSelection | undefined;
  
  runSelection?: ModelSelection | undefined;
  
  actorSelection?: ModelSelection | undefined;
}

interface WorkflowActorModelPolicy {
  
  configOverrides: {
    modelSelection?: ModelSelection;
  };
}

export class WorkflowActorPinnedModelError extends Error {
  readonly pinnedModel: string;

  constructor(pinnedModel: string, cause?: unknown) {
    super(`Cannot construct the model pinned for this subagent: ${pinnedModel}`);
    this.name = "WorkflowActorPinnedModelError";
    this.pinnedModel = pinnedModel;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export class WorkflowActorModelUnboundError extends Error {
  readonly modelName: string;

  constructor(modelName: string, bound: readonly string[]) {
    super(
      `This subagent's persona names the model "${modelName}", which the run did not resolve at launch` +
        (bound.length === 0
          ? " (the script named no models)."
          : ` (it resolved: ${bound.map((name) => `"${name}"`).join(", ")}).`),
    );
    this.name = "WorkflowActorModelUnboundError";
    this.modelName = modelName;
  }
}

export function resolveActorPersonaModel(
  personaModel: string | undefined,
  bindings: Readonly<Record<string, string>> | undefined,
): ModelSelection | undefined {
  if (personaModel === undefined) return undefined;
  const canonical = bindings?.[personaModel];
  if (canonical === undefined) {
    throw new WorkflowActorModelUnboundError(personaModel, Object.keys(bindings ?? {}));
  }
  return parseModelPickerValue(canonical);
}

export function workflowActorModelPolicy(
  host: WorkflowActorModelHost,
  pinnedModel?: string,
): WorkflowActorModelPolicy {
  if (host.actorSelection !== undefined) {
    return { configOverrides: { modelSelection: host.actorSelection } };
  }
  if (host.runSelection !== undefined) {
    return { configOverrides: { modelSelection: host.runSelection } };
  }
  if (pinnedModel === undefined) return { configOverrides: {} };
  const pinned = parsePinnedModel(pinnedModel);
  if (host.parentSelection !== undefined && sameModelIdentity(pinned, host.parentSelection)) {
    return { configOverrides: {} };
  }
  return { configOverrides: { modelSelection: pinned } };
}

function sameModelIdentity(a: ModelSelection, b: ModelSelection): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId;
}

function parsePinnedModel(pinnedModel: string): ModelSelection {
  const parsed = parseProviderQualifiedModelSelection(pinnedModel);
  if (parsed === undefined) throw new WorkflowActorPinnedModelError(pinnedModel);
  return parsed;
}
