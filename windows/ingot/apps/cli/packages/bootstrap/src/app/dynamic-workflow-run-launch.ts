// ============================================================
// ============================================================
//

import { randomUUID } from "node:crypto";
import {
  CoreErrorType,
  CF_DWF_CHILD_COMMAND,
  type CreateSessionTaskLinkInput,
  type SessionId,
} from "@origin-ai/cf-contracts";
import type { AgentRuntime } from "@origin-ai/cf-core";
import { parseModelPickerValue, type ModelSelection } from "@origin-ai/cf-shared/model-selection";
import {
  type ActorSubmitProfile,
  refToString,
  validate,
  type ActorRef,
  type AskSpec,
  type Caps,
  type ImportedRunCache,
  type JournalStorePort,
  type JsonSchema,
  type RunSettlement,
  type ValidateFn,
} from "@origin-ai/cf-dynamic-workflow";
import { runWorkflowScript } from "@origin-ai/cf-dynamic-workflow-runtime";
import { createJournalSequenceCapture } from "./dynamic-workflow-run-sequence-capture.js";
import type { CompiledHole } from "./dynamic-workflow-run-holes.js";
import { toProgressPayload } from "./dynamic-workflow-run-progress-payload.js";
import {
  readRunLaunchAnchor,
  readRunModelBindings,
  readRunSubagentModel,
  readRunSubagentPermissionMode,
  type RunLaunch,
} from "./dynamic-workflow-run-launch-anchor.js";
import { resolveWorkflowDefaultConcurrency } from "./workflow-default-concurrency.js";
import type { ActorSessionQuiescence } from "./workflow-driver-quiescence.js";
import { resolveActorPersonaModel } from "./workflow-actor-model.js";
import { createAgentRuntimeWorkflowDriver } from "./workflow-driver.js";
import type { WorkflowEscalationRegistry } from "./workflow-escalation-registry.js";
import { runBoundTarget, type WorkflowRunControl } from "./workflow-run-control.js";
import { createWorkflowRunSeatGate } from "./workflow-seat-gate.js";
import type { DynamicWorkflowRunServiceDeps } from "./dynamic-workflow-run-service.js";

export { toProgressPayload, toProtocolEvent } from "./dynamic-workflow-run-progress-payload.js";

const validateFn: ValidateFn = (schema, value) => validate(schema as JsonSchema, value);

export interface CompiledDynamicWorkflowScript {
  lowered: string;
  scriptHash: string;
  askSpecs: Map<string, AskSpec>;
  
  actorSubmitProfiles: ReadonlyMap<string, ActorSubmitProfile>;
  
  sitePhases: ReadonlyMap<string, string>;
  
  holeBodies: Readonly<Record<string, string>>;
  
  holes: readonly CompiledHole[];
  
  phases: { phaseNames: string[]; holes: number[] };
}

interface LaunchDynamicWorkflowRunInput {
  caps: Caps;
  compiled: CompiledDynamicWorkflowScript;
  cwd: string;
  deps: DynamicWorkflowRunServiceDeps;
  
  name?: string;
  
  args?: Record<string, unknown>;
  parentSessionId?: string;
  runId: string;
  scriptText: string;
  signal: AbortSignal;
  toolCallId?: string;
  
  resumedFrom?: string;
  importedCache?: ImportedRunCache;
  
  inheritedTokens?: number;
  
  launch?: RunLaunch;
  
  escalationRegistry: WorkflowEscalationRegistry;
  
  control?: WorkflowRunControl;
  
  onQuiescenceProbe?: (probe: ActorSessionQuiescence) => void;
  
  holeTypeOf?: (siteId: string) => string | undefined;
}

export function launchDynamicWorkflowRun(
  input: LaunchDynamicWorkflowRunInput,
): Promise<RunSettlement> {
  const {
    args,
    caps,
    compiled,
    control,
    cwd,
    deps,
    escalationRegistry,
    importedCache,
    name,
    parentSessionId,
    resumedFrom,
    runId,
    scriptText,
    signal,
    toolCallId,
  } = input;
  const childSpawn = dynamicWorkflowChildSpawn();
  const seatGate = createWorkflowRunSeatGate({ limit: caps.maxConcurrency });
  deps.concurrency?.setRunBound(runId, caps.maxConcurrency);
  control?.bindSeatGate(runBoundTarget(seatGate, deps.concurrency, runId));
  const launch = input.launch ?? readRunLaunchAnchor(deps.journal, runId);
  const lineageFrom = resumedFrom ?? deps.journal.getRun(runId)?.resumedFrom;
  const defaultConcurrency = resolveWorkflowDefaultConcurrency(deps.availableParallelism);
  const subagentModel = input.launch?.subagentModel ?? readRunSubagentModel(deps.journal, runId);
  const runSubagentModel =
    subagentModel === undefined ? undefined : parseModelPickerValue(subagentModel);
  const modelBindings = input.launch?.modelBindings ?? readRunModelBindings(deps.journal, runId);
  const subagentPermissionMode =
    input.launch === undefined
      ? readRunSubagentPermissionMode(deps.journal, runId)
      : input.launch.subagentPermissionMode;

  const sequenceCapture = createJournalSequenceCapture(deps.journal);

  const makeDriver = createAgentRuntimeWorkflowDriver({
    journal: sequenceCapture.journal,
    emit: (event) => {
      try {
        if (deps.onRunEvent === undefined) return;
        deps.onRunEvent(
          toProgressPayload({
            event,
            runId,
            sequence: sequenceCapture.sequenceOf(event),
            ...(toolCallId === undefined ? {} : { toolCallId }),
            ...(input.holeTypeOf === undefined ? {} : { holeTypeOf: input.holeTypeOf }),
            ...(() => {
              const reachedAt = sequenceCapture.timeCreatedOf(event);
              return reachedAt === undefined ? {} : { reachedAt };
            })(),
            ...(launch === undefined ? {} : { launchInputId: launch.inputId }),
            ...(lineageFrom === undefined ? {} : { resumedFrom: lineageFrom }),
            concurrencyCeiling: defaultConcurrency,
            ...(subagentModel === undefined ? {} : { subagentModel }),
            ...(modelBindings === undefined ? {} : { modelBindings }),
          }),
          parentSessionId === undefined ? {} : { parentSessionId },
        );
      } catch (error) {
        deps.logger?.warn?.("Dynamic workflow run event hook failed", {
          errorMessage: error instanceof Error ? error.message : String(error),
          event: "dynamic_workflow.run_event.hook_failed",
          module: "bootstrap.app",
          runId,
        });
      }
    },
    executionPort: deps.executionPort,
    fileSystemPort: deps.fileSystemPort,
    escalationRegistry,
    cwd,
    ...(deps.artifactStore === undefined
      ? {}
      : {
          artifactStore: deps.artifactStore,
          parentSessionId: deps.parentSessionId as SessionId,
        }),
    actorSubmitProfiles: compiled.actorSubmitProfiles,
    runId,
    ...(deps.actorTranscriptStore === undefined
      ? {}
      : { actorTranscriptStore: deps.actorTranscriptStore }),
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    ...(deps.concurrency === undefined ? {} : { concurrency: deps.concurrency }),
    seatGate,
    ...(deps.driverClock === undefined ? {} : { clock: deps.driverClock }),
    ...(input.onQuiescenceProbe === undefined
      ? {}
      : { onQuiescenceProbe: input.onQuiescenceProbe }),
    runtimeFactory: async ({
      sessionId,
      actor,
      persona,
      escalatePort,
      seed,
      submitPort,
      submitProfile,
      modelRequestAdmission,
    }) => {
      const runtime = deps.createActorRuntime({
        runId,
        sessionId,
        actor,
        persona,
        submitPort,
        submitProfile,
        ...(modelRequestAdmission === undefined ? {} : { modelRequestAdmission }),
        escalatePort,
        //
        pinnedModel:
          pinnedActorModel({ actor, journal: deps.journal, runId }) ?? seed?.resolvedModel,
        ...(runSubagentModel === undefined ? {} : { runSubagentModel }),
        ...(() => {
          const actorModel = resolveActorPersonaModel(persona.model, modelBindings);
          return actorModel === undefined ? {} : { actorModel };
        })(),
        ...(subagentPermissionMode === undefined ? {} : { subagentPermissionMode }),
      });
      journalActorResolvedModel({
        actor,
        journal: deps.journal,
        selection: requireActorModelSelection(runtime, actor),
        runId,
      });
      const attached = await attachActorSession({
        actor,
        deps,
        runId,
        runtime,
        sessionId,
      });
      if (attached === "rehydrated") return runtime;
      await persistActorSession({
        actor,
        deps,
        parentSessionId,
        runId,
        runtime,
        sessionId,
      });
      return runtime;
    },
  });

  const settlement = runWorkflowScript({
    askSpecs: compiled.askSpecs,
    sitePhases: compiled.sitePhases,
    caps,
    ...(childSpawn === undefined ? {} : { childSpawn }),
    cwd,
    lowered: compiled.lowered,
    makeDriver,
    onWarning: (warning) => {
      deps.logger?.warn?.("Dynamic workflow entry file fell back to the OS temp dir", {
        event: "dynamic_workflow.entry_file.fallback",
        module: "bootstrap.app",
        runId,
        ...warning,
      });
    },
    ...(name === undefined ? {} : { name }),
    ...(args === undefined ? {} : { args }),
    ...(parentSessionId === undefined ? {} : { parentSessionId }),
    runId,
    scriptHash: compiled.scriptHash,
    scriptText,
    ...(toolCallId === undefined ? {} : { toolCallId }),
    ...(resumedFrom === undefined ? {} : { resumedFrom }),
    ...(importedCache === undefined ? {} : { importedCache }),
    ...(input.inheritedTokens === undefined ? {} : { inheritedTokens: input.inheritedTokens }),
    ...(launch === undefined ? {} : { launch }),
    signal,
    ...(control === undefined ? {} : { control }),
    validate: validateFn,
  });
  return settlement.finally(() => deps.concurrency?.clearRunBound(runId));
}

export function dynamicWorkflowChildSpawn(
  isSea: boolean = isSeaRuntime(),
): { argsPrefix: readonly string[] } | undefined {
  return isSea ? { argsPrefix: [CF_DWF_CHILD_COMMAND] } : undefined;
}

function isSeaRuntime(): boolean {
  const getBuiltinModule = process.getBuiltinModule as
    | ((id: "node:sea") => { isSea(): boolean })
    | undefined;
  try {
    return getBuiltinModule?.("node:sea").isSea() === true;
  } catch {
    return false;
  }
}

async function attachActorSession(input: {
  actor: ActorRef;
  deps: DynamicWorkflowRunServiceDeps;
  runId: string;
  runtime: AgentRuntime;
  sessionId: SessionId;
}): Promise<"fresh" | "rehydrated"> {
  const { actor, deps, runId, runtime } = input;
  const journaledSessionId = deps.journal.getActor(runId, actor.siteId, actor.ordinal)?.sessionId;
  if (journaledSessionId === undefined) return "fresh";
  try {
    await runtime.resumeFromStore();
    return "rehydrated";
  } catch (error) {
    if (!isSessionNotFound(error)) throw error;
    deps.logger?.warn?.("Dynamic workflow actor session pruned; starting fresh", {
      actor: refToString(actor),
      event: "dynamic_workflow.actor.rehydrate_fallback",
      module: "bootstrap.app",
      runId,
      sessionId: input.sessionId,
    });
    return "fresh";
  }
}

function isSessionNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: unknown }).type === CoreErrorType.SessionNotFound
  );
}

async function persistActorSession(input: {
  actor: ActorRef;
  deps: DynamicWorkflowRunServiceDeps;
  parentSessionId?: string;
  runId: string;
  runtime: AgentRuntime;
  sessionId: SessionId;
}): Promise<void> {
  const { actor, deps, parentSessionId, runId, runtime, sessionId } = input;
  const title = `workflow subagent ${refToString(actor)}`;

  await runtime.ensureSessionPersistedForExternalActivity(title);

  if (deps.taskLinkStore) {
    await deps.taskLinkStore.createSessionTaskLink({
      childSessionId: sessionId,
      id: `tasklink_${randomUUID()}`,
      // `root_workflow_run_id text references workflow_run(id)`（migration 0007，
      //
      path: `dwf/${runId}/${refToString(actor)}`,
      ...(parentSessionId === undefined ? {} : { parentSessionId: parentSessionId as SessionId }),
      role: "workflow_actor",
      status: "running",
    } satisfies CreateSessionTaskLinkInput);
  }
}

export function journalActorResolvedModel(input: {
  actor: ActorRef;
  journal: JournalStorePort;
  selection: ModelSelection;
  runId: string;
}): void {
  const { actor, journal, selection, runId } = input;
  const existing = journal.getActor(runId, actor.siteId, actor.ordinal);
  journal.putActor({
    ...(existing ?? { runId, siteId: actor.siteId, ordinal: actor.ordinal }),
    resolvedModel: formatActorResolvedModel(selection),
  });
}

function formatActorResolvedModel(selection: ModelSelection): string {
  return `${selection.providerId}/${selection.modelId}`;
}

function requireActorModelSelection(runtime: AgentRuntime, actor: ActorRef): ModelSelection {
  const selection = runtime.getSessionModelSelection();
  if (selection === undefined) {
    throw new Error(
      `actor Session没有Model Selection，无法记录 resolvedModel: ${actor.siteId}#${actor.ordinal}`,
    );
  }
  return selection;
}

export function pinnedActorModel(input: {
  actor: ActorRef;
  journal: JournalStorePort;
  runId: string;
}): string | undefined {
  return input.journal.getActor(input.runId, input.actor.siteId, input.actor.ordinal)
    ?.resolvedModel;
}
