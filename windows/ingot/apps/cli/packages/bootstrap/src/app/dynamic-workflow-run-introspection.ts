// ============================================================
// ============================================================

import type {
  DynamicWorkflowRunDetail,
  DynamicWorkflowRunHole,
  DynamicWorkflowRunLifecycleStatus,
  DynamicWorkflowRunListItem,
  DynamicWorkflowRunListQuery,
  DynamicWorkflowRunListResult,
  DynamicWorkflowRunPendingQuestion,
  DynamicWorkflowRunPort,
} from "@origin-ai/cf-contracts";
import { NON_REPORT_NODE_KINDS, type JournalStorePort } from "@origin-ai/cf-dynamic-workflow";
import { reduceWorkflowRunsState, type WorkflowRunsState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { DynamicWorkflowIntrospectableJournal } from "./dynamic-workflow-run-journal.js";
import {
  readRunModelBindings,
  readRunScriptPath,
  readRunSubagentModel,
} from "./dynamic-workflow-run-launch-anchor.js";
import {
  artifactsOf,
  journalRunSummary,
  registryRunSummary,
  runConcurrencyField,
  runScriptPathField,
  runModelBindingsField,
  runSubagentModelField,
  terminalErrorField,
  terminalResultField,
  toLogTailEntry,
  TERMINAL_RUN_STATUSES,
  type RunRegistryEntry,
} from "./dynamic-workflow-run-observation.js";
import {
  COLD_REPLAY_EVENT_READ,
  replayRunProgressFromEvents,
} from "./dynamic-workflow-run-replay.js";
import { runHolesOf } from "./dynamic-workflow-run-holes.js";
import { buildWorkflowRunRoster } from "./dynamic-workflow-run-roster.js";
import type { WorkflowEscalationRegistry } from "./workflow-escalation-registry.js";

const DEFAULT_LOG_TAIL_LIMIT = 20;

interface DynamicWorkflowRunIntrospectionContext {
  
  introspection: DynamicWorkflowIntrospectableJournal;
  journal: JournalStorePort;
  parentSessionId: string;
  
  runs: ReadonlyMap<string, RunRegistryEntry>;
  
  escalations: WorkflowEscalationRegistry;
  
  defaultConcurrency: () => number;
}

export function createRunIntrospectionMethods(
  ctx: DynamicWorkflowRunIntrospectionContext,
): Required<Pick<DynamicWorkflowRunPort, "listRuns" | "getRunDetail">> {
  const { introspection, journal, parentSessionId, runs, escalations, defaultConcurrency } = ctx;
  return {
    
    async listRuns(query: DynamicWorkflowRunListQuery): Promise<DynamicWorkflowRunListResult> {
      const limit = Math.max(0, query.limit);
      const rows = introspection.listRuns({
        cwd: query.cwd,
        limit: limit + 1,
        ...(query.statuses === undefined ? {} : { statuses: query.statuses }),
      });
      const journalItems = rows.map((row) => ({
        ...journalRunSummary(row, runs.get(row.runId), parentSessionId),
        spentTokens: row.spentTokens,
      }));

      const listed = new Set(rows.map((row) => row.runId));
      const gapItems: DynamicWorkflowRunListItem[] = [];
      for (const [runId, entry] of runs) {
        if (listed.has(runId) || entry.cwd !== query.cwd) continue;
        if (journal.getRun(runId) !== undefined) continue;
        const summary = registryRunSummary(runId, entry);
        if (query.statuses !== undefined && !query.statuses.includes(summary.status)) continue;
        gapItems.push({ ...summary, spentTokens: entry.inheritedTokens ?? 0 });
      }

      gapItems.sort((left, right) => right.createdAt - left.createdAt);
      const merged = [...gapItems, ...journalItems];
      const truncated = merged.length > limit;
      return {
        runs: truncated ? merged.slice(0, limit) : merged,
        ...(truncated ? { truncated: true } : {}),
      };
    },

    
    async getRunDetail(runId: string): Promise<DynamicWorkflowRunDetail | undefined> {
      const row = introspection.getRunRow(runId);
      const entry = runs.get(runId);
      if (row === undefined) {
        if (entry === undefined) return undefined;
        const gapSummary = registryRunSummary(runId, entry);
        const gapRoster = buildWorkflowRunRoster({
          run: undefined,
          events: [],
          nodes: [],
          actors: [],
          status: gapSummary.status,
          pendingQuestions: escalations.pendingFor(runId),
          now: Date.now(),
        });
        return {
          ...gapSummary,
          ...runConcurrencyField(entry.maxConcurrency, defaultConcurrency()),
          ...runSubagentModelField(entry.subagentModel),
          ...runModelBindingsField(entry.modelBindings),
          ...runScriptPathField(entry.scriptPath),
          usage: {
            spentTokens: entry.inheritedTokens ?? 0,
            nodesObserved: 0,
            nodesRunning: 0,
            nodesCompleted: 0,
            nodesFailed: 0,
          },
          actors: [],
          logTail: [],
          ...gapRoster,
          ...terminalResultField(gapSummary.status, entry),
          ...terminalErrorField(gapSummary.status, entry),
          ...pendingQuestionsField(escalations, runId),
          ...holesField(runHolesOf(runId, entry, journal)),
          ...artifactsOf(runId, journal),
        };
      }

      const summary = journalRunSummary(row, entry, parentSessionId);
      const counts = introspection.countNodesByStatus(runId);
      const stored = journal.listEvents(runId, COLD_REPLAY_EVENT_READ);
      const actorRows = journal.listActors(runId, { withPersona: false });
      const pendingQuestions = pendingQuestionsOf(escalations, runId, summary.status, entry);
      return {
        ...summary,
        ...runConcurrencyField(row.caps.maxConcurrency, defaultConcurrency()),
        ...runSubagentModelField(
          entry === undefined ? readRunSubagentModel(journal, runId) : entry.subagentModel,
        ),
        ...runModelBindingsField(
          entry === undefined ? readRunModelBindings(journal, runId) : entry.modelBindings,
        ),
        ...runScriptPathField(
          entry === undefined ? readRunScriptPath(journal, runId) : entry.scriptPath,
        ),
        usage: {
          spentTokens: row.spentTokens,
          nodesObserved: counts.running + counts.completed + counts.failed,
          nodesRunning: counts.running,
          nodesCompleted: counts.completed,
          nodesFailed: counts.failed,
        },
        actors: actorRows.map((actor) => ({
          siteId: actor.siteId,
          ordinal: actor.ordinal,
          ...(actor.name === undefined ? {} : { name: actor.name }),
        })),
        logTail: introspection
          .listRecentLogEvents(runId, DEFAULT_LOG_TAIL_LIMIT)
          .map(toLogTailEntry),
        ...buildWorkflowRunRoster({
          run: reduceRunState(row, stored, defaultConcurrency()),
          events: stored,
          nodes: journal.listNodes(runId, { kinds: NON_REPORT_NODE_KINDS, withResult: false }),
          actors: actorRows,
          status: summary.status,
          ...(pendingQuestions === undefined ? {} : { pendingQuestions }),
          now: Date.now(),
        }),
        ...terminalResultField(summary.status, entry, row),
        ...terminalErrorField(summary.status, entry, row),
        ...(pendingQuestions === undefined || pendingQuestions.length === 0
          ? {}
          : { pendingQuestions }),
        ...holesField(runHolesOf(runId, entry, journal, row.scriptText)),
        ...artifactsOf(runId, journal),
      };
    },
  };
}

function pendingQuestionsField(
  escalations: WorkflowEscalationRegistry,
  runId: string,
): Pick<DynamicWorkflowRunDetail, "pendingQuestions"> {
  const pendingQuestions = escalations.pendingFor(runId);
  return pendingQuestions.length === 0 ? {} : { pendingQuestions };
}

function holesField(
  holes: readonly DynamicWorkflowRunHole[],
): Pick<DynamicWorkflowRunDetail, "holes"> {
  return holes.length === 0 ? {} : { holes };
}

function pendingQuestionsOf(
  escalations: WorkflowEscalationRegistry,
  runId: string,
  status: DynamicWorkflowRunLifecycleStatus,
  entry: RunRegistryEntry | undefined,
): readonly DynamicWorkflowRunPendingQuestion[] | undefined {
  const known = entry !== undefined || TERMINAL_RUN_STATUSES.has(status);
  return known ? escalations.pendingFor(runId) : undefined;
}

function reduceRunState(
  row: Parameters<typeof replayRunProgressFromEvents>[0],
  stored: Parameters<typeof replayRunProgressFromEvents>[1],
  defaultConcurrency: number,
): WorkflowRunsState["runs"][number] | undefined {
  let state: WorkflowRunsState | undefined;
  for (const payload of replayRunProgressFromEvents(row, stored, defaultConcurrency)) {
    state = reduceWorkflowRunsState(state, payload) ?? state;
  }
  return state?.runs.find((run) => run.runId === row.runId);
}
