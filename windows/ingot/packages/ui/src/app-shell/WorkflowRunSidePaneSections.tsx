// ============================================================
// ============================================================

import { workflowRunStopReasonMessageId } from "@/components/workflow-graph/run-status-presentation.js";
import { memo, type ReactNode } from "react";
import type { WorkflowRunSaveSlots } from "@/project-workflow/WorkflowRunSaveControls.js";
import {
  ArrowUpRightIcon,
  ListIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  SquareIcon,
} from "lucide-react";
import type { WorkflowRunState, WorkflowRunUsage } from "@origin-ai/cf-shared/cf-protocol-v4";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { workflowRunResultView } from "@/app-shell/workflowRunPanel.js";
import { workflowRunConcurrencyChip } from "@/app-shell/workflowRunThrottle.js";
import { WorkflowRunStatus } from "@/components/workflow-timeline/WorkflowCardChrome.js";
import { RunHolesWaitingChip } from "@/components/workflow-timeline/WorkflowHoleParts.js";
import { WorkflowTruncatedNotice } from "@/components/workflow-timeline/WorkflowTruncatedNotice.js";
import { useNowTicker } from "@/components/workflow-graph/use-now-ticker.js";

const formatCount = (value: number): string => value.toLocaleString();

function SubagentModelSegment({
  children,
  className,
  configureOpen,
  onConfigureFrom,
  title,
}: {
  children: ReactNode;
  className?: string;
  configureOpen: boolean;
  onConfigureFrom?: (element: HTMLElement) => void;
  title: string;
}) {
  if (onConfigureFrom === undefined) {
    return (
      <span className={className} data-testid="workflow-run-subagent-model" title={title}>
        {children}
      </span>
    );
  }
  return (
    <button
      aria-expanded={configureOpen}
      aria-haspopup="dialog"
      className={`${className ?? ""} cursor-pointer rounded-sm text-left underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40`}
      data-testid="workflow-run-subagent-model"
      onClick={(event) => onConfigureFrom(event.currentTarget)}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

export const WorkflowRunStatusHeader = memo(function WorkflowRunStatusHeader({
  cancellable,
  configureOpen = false,
  onCancel,
  onConfigureFrom,
  onOpenSuccessor,
  onResume,
  rejection,
  resumable,
  run,
  saveSlots,
  subagentModel,
  summaryParts,
  title,
  usage,
}: {
  cancellable: boolean;
  
  configureOpen?: boolean;
  onCancel: () => void;
  
  onConfigureFrom?: (element: HTMLElement) => void;
  
  rejection?: { text: string; detail?: string };
  
  onOpenSuccessor?: () => void;
  onResume: () => void;
  resumable: boolean;
  run: WorkflowRunState | undefined;
  
  saveSlots?: WorkflowRunSaveSlots | null;
  
  subagentModel?: { name: string; title: string };
  
  summaryParts: readonly string[] | undefined;
  title: string;
  usage: WorkflowRunUsage | undefined;
}) {
  const { intl } = useCfIntl();
  const saveChip = saveSlots?.leading ?? null;
  const saveVerb = saveSlots?.trailing ?? null;
  const cancelLabel = intl.formatMessage({ id: "chat.toolCall.workflow.run.cancel" });
  const resumeLabel = intl.formatMessage({ id: "chat.toolCall.workflow.run.resume" });
  const cooldownActive = run?.concurrency?.cooldownMs !== undefined;
  const now = useNowTicker(cooldownActive);
  const concurrency = workflowRunConcurrencyChip(run, now);
  const resumedFrom = run?.resumedFrom;
  const supersededBy = run?.supersededBy;

  return (
    <div className="shrink-0 border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        {}
        <span className="min-w-0 flex-1 truncate font-mono text-ui-base font-medium text-foreground">
          {title}
        </span>
        {}
        {onConfigureFrom === undefined ? null : (
          <Button
            aria-expanded={configureOpen}
            aria-haspopup="dialog"
            data-testid="workflow-run-configure"
            onClick={(event) => onConfigureFrom(event.currentTarget)}
            size="sm"
            type="button"
            variant="outline"
          >
            <SlidersHorizontalIcon className="size-3.5" />
            {intl.formatMessage({ id: "chat.toolCall.workflow.run.configure" })}
          </Button>
        )}
        {}
        {resumable ? (
          <ControlHintTooltip
            title={intl.formatMessage({ id: "chat.toolCall.workflow.run.resumeHint" })}
            side="bottom"
          >
            <Button
              aria-label={resumeLabel}
              data-testid="workflow-run-resume"
              onClick={onResume}
              size="sm"
              type="button"
              variant="outline"
            >
              <RotateCcwIcon className="size-3.5" />
              {resumeLabel}
            </Button>
          </ControlHintTooltip>
        ) : null}
        {}
        {saveVerb}
        {}
        <ControlHintTooltip
          title={
            cancellable
              ? cancelLabel
              : intl.formatMessage({ id: "chat.toolCall.workflow.run.cancelDisabled" })
          }
          side="bottom"
          {...(cancellable
            ? { description: intl.formatMessage({ id: "chat.toolCall.workflow.run.stopHint" }) }
            : {})}
        >
          <Button
            aria-label={cancelLabel}
            data-testid="workflow-run-cancel"
            disabled={!cancellable}
            onClick={onCancel}
            size="sm"
            type="button"
            variant="outline"
          >
            <SquareIcon className="size-3.5 fill-current" />
            {cancelLabel}
          </Button>
        </ControlHintTooltip>
      </div>
      {}
      {run === undefined && concurrency === undefined && saveChip === null ? null : (
        <div
          className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2"
          data-testid="workflow-run-status-row"
        >
          {run ? <WorkflowRunStatus run={run} testId="workflow-run-status" /> : null}
          {}
          <RunHolesWaitingChip run={run} testId="workflow-run-holes" />
          {}
          {saveChip}
          {}
          {concurrency === undefined ? null : (
            <span
              className="shrink-0 rounded-xs border border-warning/60 px-1.5 py-0.5 font-mono text-ui-xs leading-none text-warning"
              data-testid="workflow-run-concurrency"
            >
              {intl.formatMessage(
                { id: "chat.toolCall.workflow.run.concurrency.label" },
                { cap: String(concurrency.cap) },
              )}
              {concurrency.cooldownUntil === undefined
                ? null
                : ` · ${intl.formatMessage(
                    { id: "chat.toolCall.workflow.run.concurrency.cooldown" },
                    { time: new Date(concurrency.cooldownUntil).toLocaleTimeString() },
                  )}`}
            </span>
          )}
        </div>
      )}

      {}
      {rejection === undefined ? null : (
        <div
          className="mt-1.5 text-ui-xs text-warning"
          data-testid="workflow-run-rejection"
          role="status"
        >
          <span>{rejection.text}</span>
          {rejection.detail === undefined ? null : (
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-ui-xs text-foreground-subtle">
              {rejection.detail}
            </pre>
          )}
        </div>
      )}

      {resumedFrom === undefined ? null : (
        <div
          className="mt-1.5 flex min-w-0 items-baseline gap-2 text-ui-xs text-foreground-subtlest"
          data-testid="workflow-run-amends"
        >
          <span className="shrink-0">
            {intl.formatMessage({ id: "chat.toolCall.workflow.run.amends" })}
          </span>
          <span className="min-w-0 truncate font-mono" title={resumedFrom}>
            {resumedFrom}
          </span>
        </div>
      )}
      {supersededBy === undefined ? null : onOpenSuccessor === undefined ? (
        <div
          className="mt-1.5 flex min-w-0 items-baseline gap-2 text-ui-xs text-foreground-subtlest"
          data-testid="workflow-run-superseded-by"
        >
          <span className="shrink-0">
            {intl.formatMessage({ id: "chat.toolCall.workflow.run.supersededBy" })}
          </span>
          <span className="min-w-0 truncate font-mono" title={supersededBy}>
            {supersededBy}
          </span>
        </div>
      ) : (
        <button
          className="mt-1.5 flex min-w-0 cursor-pointer items-baseline gap-2 rounded-md text-left text-ui-xs text-foreground-subtle outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          data-testid="workflow-run-superseded-by"
          onClick={onOpenSuccessor}
          type="button"
        >
          <span className="shrink-0">
            {intl.formatMessage({ id: "chat.toolCall.workflow.run.supersededBy" })}
          </span>
          <span className="min-w-0 truncate font-mono" title={supersededBy}>
            {supersededBy}
          </span>
          <ArrowUpRightIcon aria-hidden className="size-3 shrink-0 self-center" />
        </button>
      )}

      {summaryParts !== undefined ? (
        <div
          className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-foreground-subtle"
          data-testid="workflow-run-usage"
        >
          <ListIcon aria-hidden className="size-3.5 shrink-0 text-foreground-subtlest" />
          {summaryParts.map((part, i) => (
            <span className="flex items-center gap-x-2 tabular-nums" key={i}>
              {i > 0 ? (
                <span aria-hidden className="text-foreground-subtlest">
                  ·
                </span>
              ) : null}
              {i === 0 && subagentModel !== undefined ? (
                <SubagentModelSegment
                  configureOpen={configureOpen}
                  title={subagentModel.title}
                  {...(onConfigureFrom === undefined ? {} : { onConfigureFrom })}
                >
                  {part}
                </SubagentModelSegment>
              ) : (
                <span>{part}</span>
              )}
            </span>
          ))}
        </div>
      ) : usage ? (
        <div
          className="mt-2 flex items-baseline justify-between gap-2"
          data-testid="workflow-run-usage"
        >
          {}
          <span className="flex min-w-0 items-baseline gap-2">
            {subagentModel === undefined ? null : (
              <SubagentModelSegment
                className="min-w-0 truncate text-ui-xs text-foreground-subtle"
                configureOpen={configureOpen}
                title={subagentModel.title}
                {...(onConfigureFrom === undefined ? {} : { onConfigureFrom })}
              >
                {intl.formatMessage(
                  { id: "chat.toolCall.workflow.run.subagentModel.label" },
                  { model: subagentModel.name },
                )}
              </SubagentModelSegment>
            )}
            <span className="shrink-0 text-ui-xs text-foreground-subtle">
              {intl.formatMessage({ id: "chat.toolCall.workflow.run.usage.label" })}
            </span>
          </span>
          <span className="font-mono text-ui-xs tabular-nums text-foreground">
            {intl.formatMessage(
              { id: "chat.toolCall.workflow.run.usage.value" },
              { tokens: formatCount(usage.spentTokens), steps: usage.nodesUsed },
            )}
          </span>
        </div>
      ) : null}
      {}
      <WorkflowTruncatedNotice className="mt-1.5" run={run} testId="workflow-run-truncated" />
    </div>
  );
});

export const WorkflowRunResultSections = memo(function WorkflowRunResultSections({
  result,
}: {
  result: ReturnType<typeof workflowRunResultView>;
}) {
  const { intl } = useCfIntl();

  return (
    <>
      {}
      {result.kind === "absent" ? (
        <div
          className="shrink-0 border-b border-border px-4 py-3"
          data-testid="workflow-run-untracked"
        >
          <div className="text-ui-base text-foreground">
            {intl.formatMessage({ id: "chat.toolCall.workflow.run.untracked.title" })}
          </div>
          <p className="mt-1 text-ui-xs text-foreground-subtle">
            {intl.formatMessage({ id: "chat.toolCall.workflow.run.untracked.body" })}
          </p>
        </div>
      ) : null}

      {}
      {result.kind === "completed" ? (
        <div
          className="shrink-0 border-b border-border px-4 py-3"
          data-testid="workflow-run-result"
        >
          <div className="text-ui-xs font-medium text-foreground-subtle">
            {intl.formatMessage({ id: "chat.toolCall.workflow.run.result.title" })}
          </div>
          {result.preview === undefined ? (
            <p className="mt-1 text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "chat.toolCall.workflow.run.result.completedHint" })}
            </p>
          ) : (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-ui-xs text-foreground">
              {result.preview}
            </pre>
          )}
        </div>
      ) : null}

      {result.kind === "error" ? (
        <div
          className="shrink-0 border-b border-destructive/40 px-4 py-3"
          data-testid="workflow-run-error"
        >
          <div className="text-ui-xs font-medium text-destructive">
            {intl.formatMessage({
              id:
                result.status === "stopped"
                  ? "chat.toolCall.workflow.run.result.stoppedTitle"
                  : "chat.toolCall.workflow.run.result.erroredTitle",
            })}
            {result.status === "stopped" && result.stopReason ? (
              <span
                className="font-normal text-foreground-subtle"
                data-testid="workflow-run-stop-reason"
              >
                {" · "}
                {intl.formatMessage({ id: workflowRunStopReasonMessageId(result.stopReason) })}
              </span>
            ) : null}
          </div>
          {}
          <p
            className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-ui-base text-foreground"
            data-testid="workflow-run-error-message"
          >
            {result.message ??
              intl.formatMessage({ id: "chat.toolCall.workflow.run.result.noError" })}
          </p>
        </div>
      ) : null}
    </>
  );
});
