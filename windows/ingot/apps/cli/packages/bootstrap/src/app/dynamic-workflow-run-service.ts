// ============================================================
// ============================================================
//
//

import type { DwfRunSessionListItem } from "@origin-ai/cf-adapters/storage";
import type {
  CollaborationMode,
  TraceContext,
  DynamicWorkflowRunArtifact,
  DynamicWorkflowRunArtifactBytes,
  DynamicWorkflowRunArtifactItemPage,
  DynamicWorkflowRunArtifactItemsResult,
  DynamicWorkflowRunWorkspaceNode,
  DynamicWorkflowRunWorkspaceNodeResult,
  DynamicWorkflowRunWorkspaceNodeResultQuery,
  DynamicWorkflowRunEventPage,
  DynamicWorkflowRunEventsResult,
  DynamicWorkflowResolveQuestionResult,
  DynamicWorkflowRunPort,
  DynamicWorkflowRunProgressPayload,
  DynamicWorkflowRunResumeResult,
  DynamicWorkflowRunRetuneRequest,
  DynamicWorkflowRunRetuneResult,
  DynamicWorkflowRunSessionSummary,
  DynamicWorkflowRunSnapshot,
  DynamicWorkflowRunAmendRequest,
  DynamicWorkflowRunAmendResult,
  DynamicWorkflowRunCancelInitiator,
  DynamicWorkflowRunFillHoleRequest,
  DynamicWorkflowRunSubmitRequest,
  DynamicWorkflowRunSubmitResult,
  FillWorkflowHoleResult,
  ExecutionPort,
  FileSystemPort,
  Logger,
  SessionId,
  ModelRequestAdmission,
  ModelSelection,
  ToolArtifactStorePort,
  WorkflowEscalatePort,
  WorkflowSubmitPort,
} from "@origin-ai/cf-contracts";
import type { AgentRuntime } from "@origin-ai/cf-core";
import {
  WORKFLOW_RUN_EVENTS_PAGE_LIMITS,
  WORKFLOW_RUNS_LIMITS,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type {
  ActorSubmitProfile,
  ActorRef,
  Caps,
  JournalStorePort,
  PersonaSpec,
} from "@origin-ai/cf-dynamic-workflow";
import { toProtocolEvent } from "./dynamic-workflow-run-launch.js";
import { readWorkflowArtifactBytes } from "./dynamic-workflow-run-artifact-read.js";
import { replayRunProgress } from "./dynamic-workflow-run-replay.js";
import { listArtifactItemsFrom } from "./dynamic-workflow-run-artifact-queries.js";
import {
  pageByCountOnly,
  supportsEventPages,
  supportsRunEnumeration,
  supportsRunIntrospection,
  type DynamicWorkflowTaskLinkStore,
} from "./dynamic-workflow-run-journal.js";
import { createRunIntrospectionMethods } from "./dynamic-workflow-run-introspection.js";
import { reconcileOrphanRuns } from "./dynamic-workflow-run-reconcile.js";
import {
  resumeDynamicWorkflowRun,
  amendDynamicWorkflowRun,
  submitDynamicWorkflowRun,
  type DynamicWorkflowRunEntryContext,
} from "./dynamic-workflow-run-submit.js";
import {
  listWorkspaceNodesFrom,
  readWorkspaceNodeResultFrom,
} from "./dynamic-workflow-run-workspace.js";
import {
  artifactsOf,
  settleOrAbort,
  snapshotOf,
  toSessionSummary,
  type RunRegistryEntry,
} from "./dynamic-workflow-run-observation.js";
import {
  createRunServiceLifecycle,
  type DynamicWorkflowRunSettledNotice,
} from "./dynamic-workflow-run-lifecycle.js";
import { retuneRunConcurrency } from "./dynamic-workflow-run-retune.js";
import { fillDynamicWorkflowHole } from "./dynamic-workflow-run-fill.js";
import { runHolesOf } from "./dynamic-workflow-run-holes.js";
import type { ActorTranscriptStore } from "./workflow-actor-transcript.js";
import {
  normalizeRunConcurrency,
  resolveWorkflowDefaultConcurrency,
} from "./workflow-default-concurrency.js";
import type { WorkflowConcurrencyPort } from "./workflow-concurrency-governor.js";
import type { WorkflowSubagentPermissionMode } from "./workflow-actor-permission.js";
import type { AgentRuntimeWorkflowDriverDeps } from "./workflow-driver-types.js";
import {
  createWorkflowEscalationRegistry,
  type WorkflowEscalationRegistry,
} from "./workflow-escalation-registry.js";

const DEFAULT_LIST_RUNS_LIMIT = 16;
const MAX_LIST_RUNS_LIMIT = 64;

export interface DynamicWorkflowActorRuntimeInput {
  runId: string;
  sessionId: SessionId;
  actor: ActorRef;
  persona: PersonaSpec;
  submitPort: WorkflowSubmitPort;
  
  submitProfile: ActorSubmitProfile;
  
  escalatePort: WorkflowEscalatePort;
  
  pinnedModel?: string;
  
  runSubagentModel?: ModelSelection;
  
  actorModel?: ModelSelection;
  
  subagentPermissionMode?: WorkflowSubagentPermissionMode;
  
  modelRequestAdmission?: ModelRequestAdmission;
}

export interface DynamicWorkflowRunServiceDeps {
  
  journal: JournalStorePort;
  
  resolveLaunchInputId?: (trace: TraceContext) => string | undefined;
  
  parentSessionId: string;
  
  permissionMode?: () => CollaborationMode;
  
  fileSystemPort: FileSystemPort;
  
  executionPort: ExecutionPort;
  
  artifactStore?: ToolArtifactStorePort;
  
  createActorRuntime: (input: DynamicWorkflowActorRuntimeInput) => AgentRuntime;
  
  taskLinkStore?: DynamicWorkflowTaskLinkStore;
  
  actorTranscriptStore?: ActorTranscriptStore;
  
  onRunEvent?: (
    progress: DynamicWorkflowRunProgressPayload,
    routing: { parentSessionId?: string },
  ) => void;
  logger?: Logger;
  
  availableParallelism?: () => number;
  
  concurrency?: WorkflowConcurrencyPort;
  
  registerResidencyBlockingWork?: (work: Promise<unknown>) => void;
  
  driverClock?: AgentRuntimeWorkflowDriverDeps["clock"];
  
  writeWorkflowDraft?: (input: {
    cwd: string;
    name: string;
    source: string;
  }) => Promise<{ path: string } | undefined>;
}

export {
  isDynamicWorkflowTaskLinkStore,
  resolveDynamicWorkflowJournalStore,
  supportsRunIntrospection,
  type DynamicWorkflowTaskLinkStore,
} from "./dynamic-workflow-run-journal.js";

interface DynamicWorkflowRunService extends DynamicWorkflowRunPort {
  
  countLiveRuns(): number;
  
  subscribeRunSettled(listener: (notice: DynamicWorkflowRunSettledNotice) => void): () => void;
  
  close(): Promise<void>;
}

export function createDynamicWorkflowRunService(
  deps: DynamicWorkflowRunServiceDeps,
): DynamicWorkflowRunService {
  const runs = new Map<string, RunRegistryEntry>();
  
  const escalations: WorkflowEscalationRegistry = createWorkflowEscalationRegistry();
  
  const fillQueues = new Map<string, Promise<unknown>>();

  reconcileOrphanRuns(deps);

  
  const defaultConcurrency = (): number =>
    resolveWorkflowDefaultConcurrency(deps.availableParallelism);

  const caps = (requested?: number): Caps => {
    return { maxConcurrency: normalizeRunConcurrency(requested, defaultConcurrency()) };
  };

  const introspection = supportsRunIntrospection(deps.journal) ? deps.journal : undefined;

  const {
    countLiveRuns,
    subscribeRunSettled,
    trackSettlement,
    close,
    assertOpen,
    noteForeignTerminalRow,
  } = createRunServiceLifecycle({
    journal: deps.journal,
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    parentSessionId: deps.parentSessionId,
    ...(deps.registerResidencyBlockingWork === undefined
      ? {}
      : { registerResidencyBlockingWork: deps.registerResidencyBlockingWork }),
    runs,
  });

  const entryContext: DynamicWorkflowRunEntryContext = {
    deps,
    runs,
    escalations,
    caps,
    trackSettlement,
  };

  return {
    countLiveRuns,
    subscribeRunSettled,
    close,

    async submit(
      request: DynamicWorkflowRunSubmitRequest,
    ): Promise<DynamicWorkflowRunSubmitResult> {
      assertOpen();
      return submitDynamicWorkflowRun(entryContext, request);
    },

    async amend(request: DynamicWorkflowRunAmendRequest): Promise<DynamicWorkflowRunAmendResult> {
      assertOpen();
      return amendDynamicWorkflowRun(entryContext, request);
    },

    
    defaultConcurrency,

    
    async retuneConcurrency(
      request: DynamicWorkflowRunRetuneRequest,
    ): Promise<DynamicWorkflowRunRetuneResult> {
      return retuneRunConcurrency({ runs, journal: deps.journal, defaultConcurrency }, request);
    },

    async resume(runId: string): Promise<DynamicWorkflowRunResumeResult> {
      assertOpen();
      return resumeDynamicWorkflowRun(entryContext, runId);
    },

    async listRunsForSession(limit?: number): Promise<DynamicWorkflowRunSessionSummary[]> {
      if (!supportsRunEnumeration(deps.journal)) {
        return [];
      }
      const capped = Math.max(1, Math.min(limit ?? DEFAULT_LIST_RUNS_LIMIT, MAX_LIST_RUNS_LIMIT));
      let rows: DwfRunSessionListItem[];
      try {
        rows = deps.journal.listRunsByParentSession(deps.parentSessionId, capped);
      } catch (error) {
        deps.logger?.warn?.("Dynamic workflow run enumeration failed", {
          errorMessage: error instanceof Error ? error.message : String(error),
          event: "dynamic_workflow.run.list_failed",
          module: "bootstrap.app",
        });
        return [];
      }
      return rows.map((row) => toSessionSummary(row, runs.get(row.runId)));
    },

    async replayProgressForSession(input: {
      excludeRunIds: ReadonlySet<string>;
    }): Promise<DynamicWorkflowRunProgressPayload[]> {
      if (!supportsRunEnumeration(deps.journal)) return [];
      let rows: DwfRunSessionListItem[];
      try {
        rows = deps.journal.listRunsByParentSession(
          deps.parentSessionId,
          WORKFLOW_RUNS_LIMITS.maxRuns,
        );
      } catch (error) {
        deps.logger?.warn?.("Dynamic workflow run replay enumeration failed", {
          errorMessage: error instanceof Error ? error.message : String(error),
          event: "dynamic_workflow.run.replay_failed",
          module: "bootstrap.app",
        });
        return [];
      }
      const payloads: DynamicWorkflowRunProgressPayload[] = [];
      for (const row of [...rows].reverse()) {
        if (input.excludeRunIds.has(row.runId) || runs.has(row.runId)) continue;
        payloads.push(...replayRunProgress(row, deps.journal, defaultConcurrency()));
      }
      return payloads;
    },

    async getTask(taskId: string): Promise<DynamicWorkflowRunSnapshot | undefined> {
      noteForeignTerminalRow(taskId);
      return snapshotOf(
        taskId,
        runs,
        deps.journal,
        escalations.pendingFor(taskId),
        defaultConcurrency(),
        runHolesOf(taskId, runs.get(taskId), deps.journal),
      );
    },

    
    async fillHole(request: DynamicWorkflowRunFillHoleRequest): Promise<FillWorkflowHoleResult> {
      return fillDynamicWorkflowHole({ deps, runs, fillQueues }, request);
    },

    
    async getScript(runId: string): Promise<string | undefined> {
      return runs.get(runId)?.scriptText ?? deps.journal.getRun(runId)?.scriptText;
    },

    async waitForTask(
      taskId: string,
      options?: { signal?: AbortSignal },
    ): Promise<DynamicWorkflowRunSnapshot | undefined> {
      const entry = runs.get(taskId);
      if (entry === undefined) {
        return snapshotOf(
          taskId,
          runs,
          deps.journal,
          escalations.pendingFor(taskId),
          defaultConcurrency(),
          runHolesOf(taskId, undefined, deps.journal),
        );
      }
      if (entry.terminal === undefined) await settleOrAbort(entry.settlement, options?.signal);
      return snapshotOf(
        taskId,
        runs,
        deps.journal,
        escalations.pendingFor(taskId),
        defaultConcurrency(),
        runHolesOf(taskId, entry, deps.journal),
      );
    },

    
    async resolveQuestion(
      qid: string,
      answer: string,
    ): Promise<DynamicWorkflowResolveQuestionResult> {
      return escalations.resolve(qid, answer);
    },

    async cancel(
      runId: string,
      initiator: DynamicWorkflowRunCancelInitiator = "user",
    ): Promise<boolean> {
      const entry = runs.get(runId);
      if (entry === undefined || entry.terminal !== undefined) return false;
      entry.controller.abort(initiator);
      return true;
    },

    async listEvents(
      runId: string,
      options: DynamicWorkflowRunEventPage,
    ): Promise<DynamicWorkflowRunEventsResult> {
      const page = {
        ...(options.afterSequence === undefined ? {} : { afterSequence: options.afterSequence }),
        limit: options.limit ?? WORKFLOW_RUN_EVENTS_PAGE_LIMITS.maxEvents,
        maxBytes: options.maxBytes ?? WORKFLOW_RUN_EVENTS_PAGE_LIMITS.maxBytes,
      };
      const { events, hasMore } = supportsEventPages(deps.journal)
        ? deps.journal.listEventPage(runId, page)
        : pageByCountOnly(deps.journal, runId, page);
      return {
        events: events.map((stored) => toProtocolEvent(stored.sequence, stored.event)),
        hasMore,
      };
    },

    
    async listArtifacts(runId: string): Promise<readonly DynamicWorkflowRunArtifact[] | undefined> {
      return artifactsOf(runId, deps.journal).artifacts;
    },

    
    async listArtifactItems(
      runId: string,
      artifactId: string,
      page: DynamicWorkflowRunArtifactItemPage,
    ): Promise<DynamicWorkflowRunArtifactItemsResult> {
      return listArtifactItemsFrom(deps.journal, runId, artifactId, page);
    },

    
    async readArtifact(
      runId: string,
      artifactId: string,
      version: number,
    ): Promise<DynamicWorkflowRunArtifactBytes | undefined> {
      return readWorkflowArtifactBytes(
        {
          journal: deps.journal,
          parentSessionId: deps.parentSessionId,
          ...(deps.artifactStore === undefined ? {} : { artifactStore: deps.artifactStore }),
        },
        runId,
        artifactId,
        version,
      );
    },

    
    async listWorkspaceNodes(
      runId: string,
    ): Promise<readonly DynamicWorkflowRunWorkspaceNode[] | undefined> {
      return listWorkspaceNodesFrom(
        { journal: deps.journal, parentSessionId: deps.parentSessionId },
        runId,
      );
    },

    async readWorkspaceNodeResult(
      runId: string,
      siteId: string,
      ordinal: number,
      query: DynamicWorkflowRunWorkspaceNodeResultQuery,
    ): Promise<DynamicWorkflowRunWorkspaceNodeResult | undefined> {
      return readWorkspaceNodeResultFrom(
        { journal: deps.journal, parentSessionId: deps.parentSessionId },
        runId,
        siteId,
        ordinal,
        query,
      );
    },

    ...(introspection === undefined
      ? {}
      : createRunIntrospectionMethods({
          introspection,
          journal: deps.journal,
          parentSessionId: deps.parentSessionId,
          runs,
          escalations,
          defaultConcurrency,
        })),
  };
}
