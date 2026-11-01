import type { GitRepositorySummary } from "@origin-ai/cf-shared";
import type {
  BackgroundWorkSummary,
  GoalState,
  PlanState,
  RunningSubagentSummary,
  ToolCallRow,
  WorkflowRunState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type { SessionWorkflowPhaseSummary } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  deriveSessionWorkflowPhases,
  workflowRunStepCounts,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { extractPlanToolCallContent, getPlanDirectoryTitle } from "@/lib/planToolCall.js";
import { workflowRunParallelPhaseLabel } from "@/lib/workflowRunLine.js";

export interface ConversationStatusPanelGitModel {
  branchName: string | null;
  headRefType: GitRepositorySummary["headRefType"];
  dirtyFileCount: number;
  added: number;
  removed: number;
  ahead: number;
  behind: number;
  isClean: boolean;
}

export interface ConversationStatusPanelPlanModel {
  items: PlanState["items"];
  displayItems: PlanState["items"];
  completedCount: number;
  waitingCount: number;
  totalCount: number;
}

export interface ConversationStatusPanelSessionPlanItem {
  rowId: number;
  toolCallId: string;
  markdown: string;
  title?: string;
  planFilePath?: string;
}

export interface ConversationStatusPanelSessionPlansModel {
  items: ConversationStatusPanelSessionPlanItem[];
}

export interface ConversationStatusPanelRunningSubagent extends RunningSubagentSummary {
  controlWorkId?: string;
  cancellable?: boolean;
}

export interface ConversationStatusPanelWorkflowRun {
  
  runId: string;
  
  toolCallId?: string;
  
  status?: "pending" | "running";
  nodesSettled?: number;
  nodesTotal?: number;
  
  phases?: SessionWorkflowPhaseSummary[];
  currentPhase?: string;
  
  title?: string;
  startedAt?: number;
  
  workId?: string;
  cancellable?: boolean;
}

export interface ConversationStatusPanelWorkflowRunTarget {
  runId: string;
  toolCallId: string;
  workflowName?: string;
}

export function workflowRunOpenTarget(
  run: ConversationStatusPanelWorkflowRun,
): ConversationStatusPanelWorkflowRunTarget | null {
  if (!run.toolCallId) return null;
  return {
    runId: run.runId,
    toolCallId: run.toolCallId,
    ...(run.title && run.title !== run.runId ? { workflowName: run.title } : {}),
  };
}

export interface ConversationStatusPanelModel {
  hasContent: boolean;
  git: ConversationStatusPanelGitModel | null;
  goal: GoalState | null;
  sessionPlans: ConversationStatusPanelSessionPlansModel | null;
  plan: ConversationStatusPanelPlanModel | null;
  runningBashWorks: BackgroundWorkSummary[];
  runningSubagentWorks: ConversationStatusPanelRunningSubagent[];
  runningWorkflowRuns: ConversationStatusPanelWorkflowRun[];
}

export interface BuildConversationStatusPanelModelInput {
  isOfficeMode?: boolean;
  gitSummary?: GitRepositorySummary | null;
  gitDirtyFileCount?: number;
  gitWorktreeChangeSummary?: { added: number; removed: number } | null;
  goal?: GoalState | null;
  sessionPlans?: readonly ToolCallRow[];
  workspacePath?: string;
  plan?: PlanState | null;
  backgroundWorks?: readonly BackgroundWorkSummary[];
  runningSubagents?: readonly RunningSubagentSummary[];
  workflowRuns?: readonly WorkflowRunState[];
}

function buildGitModel({
  gitSummary,
  gitDirtyFileCount = 0,
  gitWorktreeChangeSummary,
}: Pick<
  BuildConversationStatusPanelModelInput,
  "gitSummary" | "gitDirtyFileCount" | "gitWorktreeChangeSummary"
>): ConversationStatusPanelGitModel | null {
  if (!gitSummary?.isGitAvailable || !gitSummary.isRepository) {
    return null;
  }
  const added = gitWorktreeChangeSummary?.added ?? 0;
  const removed = gitWorktreeChangeSummary?.removed ?? 0;
  if (added + removed <= 0) {
    return null;
  }
  const isClean =
    !gitSummary.isDirty &&
    gitDirtyFileCount === 0 &&
    added === 0 &&
    removed === 0 &&
    gitSummary.ahead === 0;

  return {
    branchName: gitSummary.branchName,
    headRefType: gitSummary.headRefType,
    dirtyFileCount: gitDirtyFileCount,
    added,
    removed,
    ahead: gitSummary.ahead,
    behind: gitSummary.behind,
    isClean,
  };
}

function buildPlanModel(plan: PlanState | null | undefined) {
  if (!plan || plan.items.length === 0) {
    return null;
  }
  const completed = plan.items.filter((item) => item.status === "completed");
  return {
    items: plan.items,
    displayItems: plan.items,
    completedCount: completed.length,
    waitingCount: plan.items.length - completed.length,
    totalCount: plan.items.length,
  };
}

function buildSessionPlansModel(
  rows: readonly ToolCallRow[] | undefined,
  workspacePath: string | undefined,
): ConversationStatusPanelSessionPlansModel | null {
  if (!rows?.length) return null;
  const items = rows
    .filter(
      (row) =>
        row.toolName === "ExitPlanMode" &&
        (row.status === "success" || row.status === "error" || row.status === "cancelled"),
    )
    .toSorted((left, right) => right.rowId - left.rowId)
    .flatMap((row) => {
      const content = extractPlanToolCallContent(row, workspacePath ?? "");
      if (!content.markdown) return [];
      const title = getPlanDirectoryTitle(content.markdown);
      return [
        {
          rowId: row.rowId,
          toolCallId: row.toolCallId,
          markdown: content.markdown,
          ...(title ? { title } : {}),
          ...(content.planFilePath ? { planFilePath: content.planFilePath } : {}),
        },
      ];
    });
  return items.length > 0 ? { items } : null;
}

function buildRunningWorkflowRuns(
  runs: readonly WorkflowRunState[] | undefined,
  workflowWorkByWorkId: ReadonlyMap<string, BackgroundWorkSummary>,
): ConversationStatusPanelWorkflowRun[] {
  const rows: ConversationStatusPanelWorkflowRun[] = [];
  const joinedWorkIds = new Set<string>();
  for (const run of runs ?? []) {
    if (run.status !== "pending" && run.status !== "running") continue;
    const work = workflowWorkByWorkId.get(run.runId);
    if (work) joinedWorkIds.add(run.runId);
    const steps = workflowRunStepCounts(run);
    rows.push({
      runId: run.runId,
      ...(run.toolCallId ? { toolCallId: run.toolCallId } : {}),
      status: run.status,
      nodesSettled: steps.settled,
      nodesTotal: steps.total,
      phases: deriveSessionWorkflowPhases(run),
      ...(run.currentPhase === undefined ? {} : { currentPhase: run.currentPhase }),
      ...(work ? { title: work.title, startedAt: work.startedAt } : {}),
      ...(work?.status === "running"
        ? {
            workId: work.workId,
            cancellable: work.cancellable !== false,
          }
        : {}),
    });
  }
  for (const [workId, work] of workflowWorkByWorkId) {
    if (joinedWorkIds.has(workId) || work.status !== "running") continue;
    rows.push({
      runId: workId,
      workId,
      title: work.title,
      startedAt: work.startedAt,
      cancellable: work.cancellable !== false,
    });
  }
  return rows;
}

export type ConversationStatusPanelWorkflowRunWords =
  | { kind: "status"; status: "pending" | "running" }
  | { kind: "steps"; done: number; total: number }
  | { kind: "phases"; text: string };

export function workflowRunWords(
  run: ConversationStatusPanelWorkflowRun,
): ConversationStatusPanelWorkflowRunWords | null {
  if (run.status === undefined) return null;
  if (run.status === "pending") return { kind: "status", status: "pending" };
  const phases = run.phases ?? [];
  if (phases.length === 0) {
    return { kind: "steps", done: run.nodesSettled ?? 0, total: run.nodesTotal ?? 0 };
  }
  const parallel = workflowRunParallelPhaseLabel(phases);
  if (parallel !== undefined) return { kind: "phases", text: parallel };
  if (run.currentPhase !== undefined) return { kind: "phases", text: run.currentPhase };
  return { kind: "status", status: "running" };
}

export function resolveSoleRunningWorkflowRunTarget(
  model: Pick<
    ConversationStatusPanelModel,
    "runningBashWorks" | "runningSubagentWorks" | "runningWorkflowRuns"
  >,
): ConversationStatusPanelWorkflowRunTarget | null {
  if (model.runningBashWorks.length > 0 || model.runningSubagentWorks.length > 0) return null;
  if (model.runningWorkflowRuns.length !== 1) return null;
  return workflowRunOpenTarget(model.runningWorkflowRuns[0]!);
}

export function buildConversationStatusPanelModel(
  input: BuildConversationStatusPanelModelInput,
): ConversationStatusPanelModel {
  const git = input.isOfficeMode ? null : buildGitModel(input);
  const goal = input.goal ?? null;
  const sessionPlans = buildSessionPlansModel(input.sessionPlans, input.workspacePath);
  const plan = buildPlanModel(input.plan);
  const runningBashWorks: BackgroundWorkSummary[] = [];
  const workflowWorkByWorkId = new Map<string, BackgroundWorkSummary>();
  const subagentControlByChildSessionId = new Map<string, BackgroundWorkSummary | null>();
  for (const work of input.backgroundWorks ?? []) {
    if (work.kind === "workflow") {
      //
      workflowWorkByWorkId.set(work.workId, work);
      continue;
    }
    if (work.status !== "running") continue;
    if (work.kind === "bash") {
      runningBashWorks.push(work);
    } else if (work.kind === "subagent" && work.childSessionId) {
      const existing = subagentControlByChildSessionId.get(work.childSessionId);
      subagentControlByChildSessionId.set(
        work.childSessionId,
        existing === undefined ? work : null,
      );
    }
  }
  const runningSubagentWorks: ConversationStatusPanelRunningSubagent[] = (
    input.runningSubagents ?? []
  ).map((subagent) => {
    const controlWork = subagentControlByChildSessionId.get(subagent.childSessionId);
    if (!controlWork) return subagent;
    return {
      ...subagent,
      controlWorkId: controlWork.workId,
      cancellable: controlWork.cancellable !== false,
    };
  });
  const projectedChildSessionIds = new Set(
    runningSubagentWorks.map((subagent) => subagent.childSessionId),
  );
  for (const [childSessionId, controlWork] of subagentControlByChildSessionId) {
    if (!controlWork || projectedChildSessionIds.has(childSessionId)) continue;
    runningSubagentWorks.push({
      agentId: controlWork.workId,
      childSessionId,
      controlWorkId: controlWork.workId,
      subagentType: "subagent",
      title: controlWork.title,
      status: controlWork.blocked ? "blocked" : "running",
      startedAt: controlWork.startedAt,
      cancellable: controlWork.cancellable !== false,
    });
  }

  const runningWorkflowRuns = buildRunningWorkflowRuns(input.workflowRuns, workflowWorkByWorkId);

  return {
    git,
    goal,
    sessionPlans,
    plan,
    runningBashWorks,
    runningSubagentWorks,
    runningWorkflowRuns,
    hasContent: Boolean(
      git ||
      goal ||
      sessionPlans ||
      plan ||
      runningBashWorks.length > 0 ||
      runningSubagentWorks.length > 0 ||
      runningWorkflowRuns.length > 0,
    ),
  };
}
