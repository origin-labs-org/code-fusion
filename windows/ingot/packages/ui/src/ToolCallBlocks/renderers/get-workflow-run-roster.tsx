

import type { ToolCallGetWorkflowRunDisplay } from "@origin-ai/cf-shared/cf-protocol-v4";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import {
  formatWorkflowAge,
  formatWorkflowDuration,
  formatWorkflowTokenCount,
} from "@/lib/workflowObservationFormat.js";
import {
  SITUATION_BLOCK_CLASS,
  SITUATION_ROW_CLASS,
} from "@/ToolCallBlocks/renderers/get-workflow-run-situation.js";

type WorkflowRunSubagentView = NonNullable<ToolCallGetWorkflowRunDisplay["subagents"]>[number];
type FormatMessage = ReturnType<typeof useCfIntl>["intl"]["formatMessage"];

const I18N_PREFIX = "chat.toolCall.workflow.getRun.";

const SUBAGENT_STATE_TEXT: Record<WorkflowRunSubagentView["state"], string> = {
  idle: "text-foreground-subtlest",
  executing: "text-warning",
  waiting: "text-foreground-subtle",
  parked: "text-warning",
  done: "text-success",
  failed: "text-destructive",
  unfinished: "text-foreground-subtle",
};

export function WorkflowRunSubagentRoster({
  subagents,
  generatedAt,
}: {
  subagents: readonly WorkflowRunSubagentView[];
  generatedAt: number | undefined;
}) {
  const { intl } = useCfIntl();
  if (subagents.length === 0) return null;
  return (
    <div className={SITUATION_BLOCK_CLASS} data-testid="workflow-run-subagents">
      {subagents.map((subagent) => {
        const activity = subagentActivity(subagent, generatedAt, intl.formatMessage);
        return (
          <div className="min-w-0 space-y-0.5" key={`${subagent.siteId}@${subagent.ordinal}`}>
            <div className={`${SITUATION_ROW_CLASS} text-ui-sm`}>
              {}
              {subagent.name === undefined ? null : (
                <span className="min-w-0 break-words text-foreground">{subagent.name}</span>
              )}
              <span className="break-all font-mono text-ui-xs text-foreground-subtlest">
                {subagent.siteId}@{subagent.ordinal}
              </span>
              <span className={`shrink-0 ${SUBAGENT_STATE_TEXT[subagent.state]}`}>
                {intl.formatMessage({ id: `${I18N_PREFIX}subagent.state.${subagent.state}` })}
              </span>
              {subagent.phaseName === undefined ? null : (
                <span className="min-w-0 break-words text-foreground-subtle">
                  {intl.formatMessage(
                    { id: `${I18N_PREFIX}subagent.phase` },
                    { name: subagent.phaseName },
                  )}
                </span>
              )}
              {activity.map((cell) => (
                <span className="min-w-0 break-words text-foreground-subtle" key={cell}>
                  {cell}
                </span>
              ))}
              {subagent.tokens > 0 ? (
                <span className="shrink-0 tabular-nums text-foreground-subtlest">
                  {intl.formatMessage(
                    { id: "chat.toolCall.workflow.run.usage.tokens" },
                    { tokens: formatWorkflowTokenCount(subagent.tokens) },
                  )}
                </span>
              ) : null}
            </div>
            {subagent.instructionsHead === undefined ||
            subagent.instructionsHead.length === 0 ? null : (
              <p className="min-w-0 break-words pl-3 text-ui-sm text-foreground-subtle">
                {intl.formatMessage(
                  { id: `${I18N_PREFIX}subagent.task` },
                  { task: subagent.instructionsHead },
                )}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function hasCurrentAsk(subagent: WorkflowRunSubagentView): boolean {
  return (
    subagent.startedAt !== undefined ||
    subagent.turn !== undefined ||
    subagent.toolCalls !== undefined ||
    subagent.lastTool !== undefined ||
    subagent.instructionsHead !== undefined
  );
}

function subagentActivity(
  subagent: WorkflowRunSubagentView,
  generatedAt: number | undefined,
  formatMessage: FormatMessage,
): string[] {
  if (subagent.state === "parked" && subagent.parkedOn !== undefined) {
    return [formatMessage({ id: `${I18N_PREFIX}subagent.parkedOn` }, { qid: subagent.parkedOn })];
  }
  if (subagent.state === "waiting") return waitCells(subagent, generatedAt, formatMessage);
  if (subagent.state === "unfinished" && hasCurrentAsk(subagent)) {
    return [formatMessage({ id: `${I18N_PREFIX}subagent.inFlightAtStop` })];
  }
  if (hasCurrentAsk(subagent)) {
    const cells = executingCells(subagent, generatedAt, formatMessage);
    return cells.length > 0 ? cells : settledCells(subagent, formatMessage);
  }
  return settledCells(subagent, formatMessage);
}

function executingCells(
  subagent: WorkflowRunSubagentView,
  generatedAt: number | undefined,
  formatMessage: FormatMessage,
): string[] {
  const cells: string[] = [];
  const onStep = formatWorkflowAge(generatedAt, subagent.startedAt);
  if (onStep !== undefined) {
    cells.push(formatMessage({ id: `${I18N_PREFIX}subagent.onStep` }, { age: onStep }));
  }
  if (subagent.turn !== undefined) {
    cells.push(formatMessage({ id: `${I18N_PREFIX}subagent.turn` }, { count: subagent.turn }));
  }
  if (subagent.toolCalls !== undefined) {
    cells.push(
      formatMessage(
        {
          id: `${I18N_PREFIX}subagent.${subagent.toolCalls === 1 ? "toolCallsOne" : "toolCalls"}`,
        },
        { count: subagent.toolCalls },
      ),
    );
  }
  if (subagent.lastTool !== undefined) {
    const { name, target, at } = subagent.lastTool;
    const age = formatWorkflowAge(generatedAt, at);
    cells.push(
      [
        formatMessage({ id: `${I18N_PREFIX}subagent.lastTool` }, { name }),
        target,
        age === undefined ? undefined : formatMessage({ id: `${I18N_PREFIX}age` }, { age }),
      ]
        .filter((part): part is string => part !== undefined && part.length > 0)
        .join(" "),
    );
  }
  return cells;
}

function waitCells(
  subagent: WorkflowRunSubagentView,
  generatedAt: number | undefined,
  formatMessage: FormatMessage,
): string[] {
  if (subagent.waitCause === undefined) return [];
  const cells = [
    formatMessage({
      id: `${I18N_PREFIX}subagent.${subagent.waitCause === "slot" ? "waitingSlot" : "waitingBackoff"}`,
    }),
  ];
  const waited = formatWorkflowAge(generatedAt, subagent.waitSince);
  if (waited !== undefined) {
    cells.push(formatMessage({ id: `${I18N_PREFIX}subagent.waitedFor` }, { age: waited }));
  }
  if (subagent.retryAfterMs !== undefined) {
    cells.push(
      formatMessage(
        { id: `${I18N_PREFIX}subagent.retryIn` },
        { duration: formatWorkflowDuration(subagent.retryAfterMs) },
      ),
    );
  }
  return cells;
}

function settledCells(subagent: WorkflowRunSubagentView, formatMessage: FormatMessage): string[] {
  if (subagent.stepsSettled === 0 && subagent.stepsFailed === 0) return [];
  const cells = [
    formatMessage(
      { id: `${I18N_PREFIX}subagent.${subagent.stepsSettled === 1 ? "stepsOne" : "steps"}` },
      { count: subagent.stepsSettled },
    ),
  ];
  if (subagent.stepsFailed > 0) {
    cells.push(
      formatMessage({ id: `${I18N_PREFIX}subagent.stepsFailed` }, { count: subagent.stepsFailed }),
    );
  }
  return cells;
}
