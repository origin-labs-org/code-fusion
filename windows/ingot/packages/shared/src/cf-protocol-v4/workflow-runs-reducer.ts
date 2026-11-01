// ============================================================
// ============================================================
//
//
//

import {
  WORKFLOW_RUNS_LIMITS,
  type WorkflowRunNode,
  type WorkflowRunPendingQuestion,
  type WorkflowRunReport,
  type WorkflowRunState,
  type WorkflowRunsState,
} from "./workflow-runs.js";

import { serializeWorkflowArtifact } from "./workflow-artifact.js";
import { actorsWithTranscriptSession } from "./workflow-runs-actor-session.js";
import { withDerivedWorkflowActorStatuses } from "./workflow-runs-actor-status.js";
import {
  countTaggedReport,
  upsertBoundedByArtifactId,
  workflowArtifactSummary,
} from "./workflow-runs-artifacts.js";
import {
  countUnlistedInstance,
  discountUnlistedInstance,
  evictForEntryBudget,
} from "./workflow-runs-caps.js";
import {
  absorbRefusedActor,
  absorbRefusedSettledNode,
  admitsNewEntry,
  seatWorkflowNode,
  withRoomForActor,
  type WorkflowRunEntryLimits,
} from "./workflow-runs-eviction.js";
import {
  reduceConcurrencyChanged,
  reduceRunCapsChanged,
  withoutCooldown,
} from "./workflow-runs-concurrency.js";
import {
  boundedActorName,
  boundedPhaseName,
  nonEmptyString,
  workflowActorEntry,
  workflowInstanceRef,
} from "./workflow-runs-entries.js";
import { canonicalWorkflowRun, workflowRunUnchanged } from "./workflow-runs-delta.js";
import { readRunIdField, readWorkflowRunStopReason } from "./workflow-runs-lineage.js";
import { carryNodeProgress, reduceNodeProgress } from "./workflow-runs-node-progress.js";
import { reduceHoleFilled, reduceHoleReached, withoutWaitingHoles } from "./workflow-runs-holes.js";
import { reducePhaseEntered, reduceRunLaunched } from "./workflow-runs-phases.js";
import { reduceRunStarted } from "./workflow-runs-started.js";
import { upsertBoundedByInstance, upsertBoundedByQid } from "./workflow-runs-tables.js";

const NODE_EVENT_PHASE: Readonly<Record<string, WorkflowRunNode["phase"]>> = {
  "node-queued": "queued",
  "node-dispatched": "dispatched",
  "node-executing": "executing",
  "node-waiting": "waiting",
  "node-repairing": "repairing",
  "node-nudged": "nudged",
  "node-settled": "settled",
};

export interface WorkflowRunProgressEnvelope {
  runId?: string;
  toolCallId?: string;
  sequence?: number;
  eventType?: string;
  payload?: Record<string, unknown>;
  actorSessionId?: string;
}

export function reduceWorkflowRunsState(
  previous: WorkflowRunsState | undefined,
  envelope: WorkflowRunProgressEnvelope,
  limits: WorkflowRunEntryLimits = WORKFLOW_RUNS_LIMITS,
): WorkflowRunsState | null {
  const runId = envelope.runId;
  if (!runId || typeof envelope.eventType !== "string") return null;
  const sequence = typeof envelope.sequence === "number" ? envelope.sequence : 0;
  const payload = isPlainRecord(envelope.payload) ? envelope.payload : {};

  const prior: WorkflowRunsState = previous ?? { revision: 0, runs: [] };
  const existing = prior.runs.find((run) => run.runId === runId);
  const base: WorkflowRunState = existing ?? {
    runId,
    ...(envelope.toolCallId ? { toolCallId: envelope.toolCallId } : {}),
    status: "pending",
    usage: { spentTokens: 0, nodesUsed: 0 },
    actors: [],
    nodes: [],
    lastEventSequence: sequence,
  };

  const next = canonicalWorkflowRun(
    applyWorkflowRunEvent(base, envelope.eventType, payload, {
      ...(envelope.actorSessionId === undefined ? {} : { actorSessionId: envelope.actorSessionId }),
      ...(envelope.toolCallId === undefined ? {} : { toolCallId: envelope.toolCallId }),
      sequence: Math.max(base.lastEventSequence, sequence),
      advancesWaterMark: sequence > base.lastEventSequence,
      limits,
    }),
  );

  if (existing !== undefined && workflowRunUnchanged(existing, next)) return null;

  const runs = existing
    ? prior.runs.map((run) => (run.runId === runId ? next : run))
    : [...prior.runs, next];
  const bounded =
    runs.length > WORKFLOW_RUNS_LIMITS.maxRuns
      ? runs.slice(runs.length - WORKFLOW_RUNS_LIMITS.maxRuns)
      : runs;
  return { revision: prior.revision + 1, runs: evictForEntryBudget(bounded, runId) };
}

function applyWorkflowRunEvent(
  base: WorkflowRunState,
  eventType: string,
  payload: Record<string, unknown>,
  derived: {
    actorSessionId?: string;
    toolCallId?: string;
    sequence: number;
    advancesWaterMark: boolean;
    limits: WorkflowRunEntryLimits;
  },
): WorkflowRunState {
  const run: WorkflowRunState = {
    ...base,
    ...(derived.toolCallId && !base.toolCallId ? { toolCallId: derived.toolCallId } : {}),
    lastEventSequence: derived.sequence,
  };

  switch (eventType) {
    
    case "run-started":
      return reduceRunStarted(run, payload);
    case "actor-created": {
      const ref = workflowInstanceRef(payload.actor);
      if (!ref) return run;
      const phaseName = boundedPhaseName(nonEmptyString(payload.phaseName));
      const { actorSessionId } = derived;
      const actor = workflowActorEntry(ref, payload.name, phaseName, actorSessionId, payload.model);
      const seated = derived.advancesWaterMark ? withRoomForActor(run, ref, derived.limits) : run;
      const upserted = upsertBoundedByInstance(seated.actors, actor, derived.limits.maxActors, {
        admitNew: admitsNewEntry(run, derived.advancesWaterMark),
      });
      const absorbed =
        upserted.truncated && derived.advancesWaterMark
          ? absorbRefusedActor(seated, phaseName, derived.limits)
          : seated;
      return withDerivedWorkflowActorStatuses({
        ...absorbed,
        actors: upserted.list,
        ...(upserted.truncated || seated.truncated ? { truncated: true } : {}),
      });
    }
    case "node-queued":
    case "node-dispatched":
    case "node-executing":
    case "node-waiting":
    case "node-repairing":
    case "node-nudged":
    case "node-settled": {
      const ref = workflowInstanceRef(payload.instance);
      if (!ref) return run;
      const phase = NODE_EVENT_PHASE[eventType]!;
      const born =
        eventType === "node-queued" || (eventType === "node-settled" && payload.cached === true);
      const actorRef = workflowInstanceRef(payload.actor);
      const dispatchActor =
        eventType === "node-dispatched" && actorRef !== null
          ? workflowActorEntry(
              actorRef,
              payload.actorName,
              boundedPhaseName(nonEmptyString(payload.actorPhaseName)),
              derived.actorSessionId,
              payload.actorModel,
            )
          : null;
      const seating = seatWorkflowNode(
        run,
        {
          eventType,
          ref,
          actorRef,
          actor: dispatchActor,
          born,
          advancesWaterMark: derived.advancesWaterMark,
        },
        derived.limits,
      );
      const seated = seating.run;
      const previousNode = seated.nodes.find(
        (node) => node.siteId === ref.siteId && node.ordinal === ref.ordinal,
      );
      const kind =
        payload.kind === "ask" || payload.kind === "world-read" ? payload.kind : previousNode?.kind;
      const phaseName =
        boundedPhaseName(nonEmptyString(payload.phaseName)) ?? previousNode?.phaseName;
      const node: WorkflowRunNode = {
        siteId: ref.siteId,
        ordinal: ref.ordinal,
        ...(kind === undefined ? {} : { kind }),
        phase,
        ...(payload.outcome === "ok" ||
        payload.outcome === "failed" ||
        payload.outcome === "cancelled"
          ? { outcome: payload.outcome }
          : {}),
        ...(payload.cached === true ? { cached: true } : {}),
        ...(actorRef
          ? { actorSiteId: actorRef.siteId, actorOrdinal: actorRef.ordinal }
          : previousNode?.actorSiteId !== undefined
            ? { actorSiteId: previousNode.actorSiteId, actorOrdinal: previousNode.actorOrdinal }
            : {}),
        ...(phaseName === undefined ? {} : { phaseName }),
        ...carryNodeProgress(eventType, payload, previousNode),
      };
      const upsertedNodes = upsertBoundedByInstance(seated.nodes, node, derived.limits.maxNodes, {
        admitNew: seating.admitNew,
      });
      const firstDispatch =
        eventType === "node-dispatched" &&
        admitsNewEntry(run, derived.advancesWaterMark) &&
        (previousNode === undefined || previousNode.phase === "queued");
      const restored = seating.activated ? discountUnlistedInstance(seated.usage) : seated.usage;
      const usage = countUnlistedInstance(
        firstDispatch ? { ...restored, nodesUsed: restored.nodesUsed + 1 } : restored,
        {
          rejected: upsertedNodes.truncated,
          advancesWaterMark: derived.advancesWaterMark,
          eventType,
          cached: payload.cached === true,
        },
      );
      const absorbed =
        upsertedNodes.truncated && derived.advancesWaterMark && born && phase === "settled"
          ? absorbRefusedSettledNode(seated, node, derived.limits)
          : seated;
      return withDerivedWorkflowActorStatuses({
        ...absorbed,
        actors: actorsWithTranscriptSession(
          absorbed.actors,
          eventType,
          payload,
          actorRef,
          derived.actorSessionId,
        ),
        ...(usage === seated.usage ? {} : { usage }),
        nodes: upsertedNodes.list,
        ...(upsertedNodes.truncated || seated.truncated ? { truncated: true } : {}),
      });
    }
    
    case "node-progress": {
      const ref = workflowInstanceRef(payload.instance);
      if (!ref) return run;
      return reduceNodeProgress(run, ref, payload);
    }
    
    case "report": {
      const ref = workflowInstanceRef(payload.instance);
      if (!ref) return run;
      const artifactId = nonEmptyString(payload.artifactId);
      const report: WorkflowRunReport = {
        siteId: ref.siteId,
        ordinal: ref.ordinal,
        preview: workflowReportPreview(payload.item),
        ...(artifactId === undefined ? {} : { artifactId }),
      };
      const existingReports = run.reports ?? [];
      const firstSighting = !existingReports.some(
        (item) => item.siteId === ref.siteId && item.ordinal === ref.ordinal,
      );
      const upserted = upsertBoundedByInstance(
        existingReports,
        report,
        WORKFLOW_RUNS_LIMITS.maxReports,
      );
      const counted =
        artifactId !== undefined && firstSighting
          ? countTaggedReport(run.artifacts, artifactId)
          : run.artifacts;
      return {
        ...run,
        reports: upserted.list,
        ...(counted === undefined ? {} : { artifacts: counted }),
        ...(upserted.truncated || run.truncated ? { truncated: true } : {}),
      };
    }

    
    case "artifact-published": {
      const summary = workflowArtifactSummary(payload.artifact);
      if (summary === undefined) return run;
      const upserted = upsertBoundedByArtifactId(
        run.artifacts ?? [],
        summary,
        WORKFLOW_RUNS_LIMITS.maxArtifacts,
      );
      return {
        ...run,
        artifacts: upserted.list,
        ...(upserted.truncated || run.truncated ? { truncated: true } : {}),
      };
    }

    
    case "artifact-failed":
      return run;
    case "usage-updated": {
      if (typeof payload.spentTokens !== "number") return run;
      return { ...run, usage: { ...run.usage, spentTokens: payload.spentTokens } };
    }
    
    case "escalation-raised": {
      const qid = nonEmptyString(payload.qid);
      const question = nonEmptyString(payload.question);
      if (qid === undefined || question === undefined) return run;
      const actorRef = workflowInstanceRef(payload.actor);
      const actorName = boundedActorName(nonEmptyString(payload.actorName));
      const context = nonEmptyString(payload.context);
      const askedAt =
        typeof payload.askedAt === "number" && Number.isFinite(payload.askedAt)
          ? payload.askedAt
          : undefined;
      const pending: WorkflowRunPendingQuestion = {
        qid,
        ...(actorRef ? { actorSiteId: actorRef.siteId, actorOrdinal: actorRef.ordinal } : {}),
        ...(actorName === undefined ? {} : { actorName }),
        question: boundedQuestionText(question),
        ...(context === undefined ? {} : { context: boundedQuestionText(context) }),
        ...(askedAt === undefined ? {} : { askedAt }),
      };
      const upserted = upsertBoundedByQid(
        run.pendingQuestions ?? [],
        pending,
        WORKFLOW_RUNS_LIMITS.maxPendingQuestions,
      );
      return {
        ...run,
        pendingQuestions: upserted.list,
        ...(upserted.truncated || run.truncated ? { truncated: true } : {}),
      };
    }

    
    case "escalation-resolved": {
      const qid = nonEmptyString(payload.qid);
      if (qid === undefined) return run;
      return withoutPendingQuestions(run, (pending) => pending.qid !== qid);
    }

    
    case "concurrency-changed":
      return reduceConcurrencyChanged(run, payload);

    
    case "run-caps-changed":
      return reduceRunCapsChanged(run, payload);

    
    case "phase-entered":
      return reducePhaseEntered(run, payload);
    case "run-launched":
      return reduceRunLaunched(run, payload);

    
    case "hole-reached":
      return reduceHoleReached(run, payload);
    case "hole-filled":
      return reduceHoleFilled(run, payload);

    case "run-settled": {
      const status = payload.status;
      const error = isPlainRecord(payload.error) ? payload.error : undefined;
      const message = typeof error?.message === "string" ? error.message : undefined;
      const cleared = withoutWaitingHoles(
        withoutCooldown(withoutPendingQuestions(run, () => false)),
      );
      const carriedStopReason =
        status === "stopped" ? readWorkflowRunStopReason(payload.stopReason) : undefined;
      const supersededBy =
        carriedStopReason === "superseded" ? readRunIdField(payload.supersededBy) : undefined;
      const terminal = status === "completed" || status === "errored" || status === "stopped";
      const settledMessage = terminal
        ? message
        : (message ?? `run settled with an unrecognized status: ${String(status)}`);
      return withDerivedWorkflowActorStatuses({
        ...cleared,
        status: terminal ? status : "errored",
        ...(carriedStopReason === undefined ? {} : { stopReason: carriedStopReason }),
        ...(supersededBy === undefined ? {} : { supersededBy }),
        ...(settledMessage === undefined
          ? {}
          : { error: settledMessage.slice(0, WORKFLOW_RUNS_LIMITS.maxErrorLength) }),
        ...(payload.resumable === true ? { resumable: true as const } : {}),
      });
    }
    default:
      return run;
  }
}

function withoutPendingQuestions(
  run: WorkflowRunState,
  keep: (pending: WorkflowRunPendingQuestion) => boolean,
): WorkflowRunState {
  const current = run.pendingQuestions;
  if (current === undefined) return run;
  const remaining = current.filter(keep);
  if (remaining.length === current.length) return run;
  if (remaining.length > 0) return { ...run, pendingQuestions: remaining };
  const { pendingQuestions: _emptied, ...withoutKey } = run;
  return withoutKey;
}

function boundedQuestionText(text: string): string {
  const limit = WORKFLOW_RUNS_LIMITS.maxQuestionLength;
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function workflowReportPreview(item: unknown): string {
  const text = serializeWorkflowArtifact(item) ?? "";
  const limit = WORKFLOW_RUNS_LIMITS.maxReportPreviewLength;
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
