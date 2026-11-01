

import type { ToolCallGetWorkflowRunDisplay } from "@origin-ai/cf-shared/cf-protocol-v4";
import { throttleReasonLabel } from "@/app-shell/workflowRunThrottle.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { formatWorkflowAge, formatWorkflowDuration } from "@/lib/workflowObservationFormat.js";

type WorkflowRunPhaseView = NonNullable<ToolCallGetWorkflowRunDisplay["phases"]>[number];
type WorkflowRunHealthView = NonNullable<ToolCallGetWorkflowRunDisplay["health"]>;

const I18N_PREFIX = "chat.toolCall.workflow.getRun.";

export const SITUATION_BLOCK_CLASS =
  "min-w-0 space-y-1 rounded-lg border border-border bg-surface px-2 py-1.5";

export const SITUATION_ROW_CLASS = "flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5";

const PHASE_STATE_TEXT: Record<WorkflowRunPhaseView["state"], string> = {
  done: "text-success",
  current: "text-warning",
  ahead: "text-foreground-subtlest",
  unfinished: "text-foreground-subtle",
};

export function WorkflowRunPhaseTrack({
  phases,
  generatedAt,
  terminal,
}: {
  phases: readonly WorkflowRunPhaseView[];
  generatedAt: number | undefined;
  terminal: boolean;
}) {
  const { intl } = useCfIntl();
  if (phases.length === 0) return null;
  return (
    <div className={SITUATION_BLOCK_CLASS} data-testid="workflow-run-phases">
      {phases.map((phase, index) => {
        const cells: string[] = [];
        if (phase.rounds > 0) {
          cells.push(
            intl.formatMessage(
              { id: `${I18N_PREFIX}phase.${phase.rounds === 1 ? "roundsOne" : "rounds"}` },
              { count: phase.rounds },
            ),
          );
        }
        if (phase.nodesSettled > 0) {
          cells.push(
            intl.formatMessage(
              { id: `${I18N_PREFIX}phase.settled` },
              { count: phase.nodesSettled },
            ),
          );
        }
        if (phase.nodesRunning > 0) {
          cells.push(
            intl.formatMessage(
              { id: `${I18N_PREFIX}phase.${terminal ? "unfinished" : "running"}` },
              { count: phase.nodesRunning },
            ),
          );
        }
        const duration = phaseDuration(phase, generatedAt, terminal, intl.formatMessage);
        return (
          <div className={SITUATION_ROW_CLASS} key={`${phase.name}-${index}`}>
            <span className="shrink-0 tabular-nums text-foreground-subtlest">{index + 1}.</span>
            <span className="min-w-0 break-words text-foreground">{phase.name}</span>
            <span className={`shrink-0 ${PHASE_STATE_TEXT[phase.state]}`}>
              {intl.formatMessage({ id: `${I18N_PREFIX}phase.state.${phase.state}` })}
            </span>
            {cells.map((cell) => (
              <span className="text-foreground-subtle" key={cell}>
                {cell}
              </span>
            ))}
            {duration === undefined ? null : (
              <span className="text-foreground-subtlest">{duration}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

type FormatMessage = ReturnType<typeof useCfIntl>["intl"]["formatMessage"];

function phaseDuration(
  phase: WorkflowRunPhaseView,
  generatedAt: number | undefined,
  terminal: boolean,
  formatMessage: FormatMessage,
): string | undefined {
  if (phase.enteredAt === undefined) return undefined;
  if (phase.exitedAt !== undefined) return formatWorkflowDuration(phase.exitedAt - phase.enteredAt);
  if (terminal) return undefined;
  const soFar = formatWorkflowAge(generatedAt, phase.enteredAt);
  return soFar === undefined
    ? undefined
    : formatMessage({ id: `${I18N_PREFIX}phase.soFar` }, { duration: soFar });
}

export function WorkflowRunHealthLine({
  health,
  generatedAt,
  terminal,
}: {
  health: WorkflowRunHealthView;
  generatedAt: number | undefined;
  terminal: boolean;
}) {
  const { intl } = useCfIntl();
  const cells: string[] = [];

  const lastProgress = formatWorkflowAge(generatedAt, health.lastProgressAt);
  if (lastProgress !== undefined) {
    cells.push(
      intl.formatMessage({ id: `${I18N_PREFIX}health.lastProgress` }, { age: lastProgress }),
    );
  }

  if (health.concurrency !== undefined) {
    const { effective, cap, reason, since } = health.concurrency;
    cells.push(intl.formatMessage({ id: `${I18N_PREFIX}health.concurrency` }, { effective, cap }));
    if (reason !== undefined) cells.push(throttleReasonLabel(reason, intl.formatMessage));
    const sinceAge = formatWorkflowAge(generatedAt, since);
    if (sinceAge !== undefined) {
      cells.push(
        intl.formatMessage({ id: `${I18N_PREFIX}health.concurrencySince` }, { age: sinceAge }),
      );
    }
  }

  if (!terminal) {
    const stalledAge = formatWorkflowAge(generatedAt, health.stalledSince);
    cells.push(
      health.stalledSince === undefined
        ? intl.formatMessage({ id: `${I18N_PREFIX}health.notStalled` })
        : stalledAge === undefined
          ? intl.formatMessage({ id: `${I18N_PREFIX}health.stalledNoClock` })
          : intl.formatMessage({ id: `${I18N_PREFIX}health.stalled` }, { age: stalledAge }),
    );
  }

  if (health.consecutiveFailures > 0) {
    cells.push(
      intl.formatMessage(
        {
          id: `${I18N_PREFIX}health.${health.consecutiveFailures === 1 ? "failuresOne" : "failures"}`,
        },
        { count: health.consecutiveFailures },
      ),
    );
  }
  if (health.cachedSteps > 0) {
    cells.push(
      intl.formatMessage(
        {
          id: `${I18N_PREFIX}health.${health.cachedSteps === 1 ? "cachedStepsOne" : "cachedSteps"}`,
        },
        { count: health.cachedSteps },
      ),
    );
  }

  const leftover = terminal ? health.leftoverRunning : undefined;
  if (cells.length === 0 && leftover === undefined) return null;
  return (
    <div className="min-w-0 space-y-1" data-testid="workflow-run-health">
      {cells.length === 0 ? null : (
        <div className={`${SITUATION_ROW_CLASS} text-ui-sm text-foreground-subtlest`}>
          {cells.map((cell) => (
            <span key={cell}>{cell}</span>
          ))}
        </div>
      )}
      {leftover === undefined ? null : (
        <p className="break-words text-ui-sm text-warning" data-testid="workflow-run-leftover">
          {intl.formatMessage(
            { id: `${I18N_PREFIX}health.${leftover === 1 ? "leftoverOne" : "leftover"}` },
            { count: leftover },
          )}
        </p>
      )}
    </div>
  );
}
