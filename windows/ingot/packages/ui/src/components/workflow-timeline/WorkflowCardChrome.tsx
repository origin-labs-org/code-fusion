import type { ReactNode } from "react";
import { ChevronRightIcon, ListIcon, Maximize2Icon, Workflow } from "lucide-react";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import {
  RUN_STATUS_DOT,
  RUN_STATUS_TEXT,
  STATUS_DOT,
  readWorkflowRunStopReason,
  workflowRunStopReasonMessageId,
  isWorkflowRunSuperseded,
} from "@/components/workflow-graph/run-status-presentation.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";

export const WORKFLOW_CARD_ICON = <Workflow className="size-4 shrink-0 text-foreground-subtle" />;

export const WORKFLOW_RUN_KIND_ID: Record<WorkflowRunState["status"], string> = {
  pending: "chat.toolCall.workflow.card.started",
  running: "chat.toolCall.workflow.card.running",
  completed: "chat.toolCall.workflow.card.completed",
  errored: "chat.toolCall.workflow.card.errored",
  stopped: "chat.toolCall.workflow.card.stopped",
};

export const WORKFLOW_RUN_ENDED_KIND_ID = "chat.toolCall.workflow.card.ended";

export const WORKFLOW_RUN_SUPERSEDED_KIND_ID = "chat.toolCall.workflow.card.superseded";

export function workflowRunKindMessageId(run: {
  status: WorkflowRunState["status"];
  stopReason?: unknown;
}): string {
  return isWorkflowRunSuperseded(run)
    ? WORKFLOW_RUN_SUPERSEDED_KIND_ID
    : WORKFLOW_RUN_KIND_ID[run.status];
}

export function WorkflowRunStatus({
  className,
  status,
  run,
  testId,
}: {
  
  status?: WorkflowRunState["status"];
  
  run?:
    | { status: WorkflowRunState["status"]; stopReason?: unknown; resumable?: unknown }
    | undefined;
  className?: string;
  testId?: string;
}) {
  const { intl } = useCfIntl();
  const effectiveStatus = status ?? run?.status ?? "pending";
  const reason =
    run === undefined ? undefined : readWorkflowRunStopReason({ ...run, status: effectiveStatus });
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", className)}>
      <span
        aria-hidden
        className={cn("wf-lamp size-2 shrink-0 rounded-full", RUN_STATUS_DOT[effectiveStatus])}
      />
      {}
      <span
        className={cn("wf-swap text-ui-sm", RUN_STATUS_TEXT[effectiveStatus])}
        data-testid={testId}
        key={effectiveStatus}
      >
        {intl.formatMessage({ id: `chat.toolCall.workflow.run.status.${effectiveStatus}` })}
      </span>
      {reason ? (
        <span
          className="text-ui-sm text-foreground-subtlest"
          data-testid={testId ? `${testId}-reason` : undefined}
        >
          · {intl.formatMessage({ id: workflowRunStopReasonMessageId(reason) })}
        </span>
      ) : null}
      {}
      {run?.resumable === true ? (
        <span
          className="text-ui-sm text-foreground-subtlest"
          data-testid={testId ? `${testId}-resumable` : undefined}
        >
          · {intl.formatMessage({ id: "chat.toolCall.workflow.run.resumable" })}
        </span>
      ) : null}
    </span>
  );
}

export function WorkflowStaticStatus({ word }: { word: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STATUS_DOT.pending)} />
      <span className="text-ui-sm text-foreground-subtle" data-testid="workflow-card-static-status">
        {word}
      </span>
    </span>
  );
}

export function WorkflowCardHeader({
  detail,
  detailTitle,
  expanded,
  kind,
  leading,
  live = false,
  name,
  onOpenDetails,
  onToggle,
  status,
  toggleLabel: toggleLabelOverride,
  trailing,
}: {
  
  kind: ReactNode;
  name: string;
  
  live?: boolean;
  status?: ReactNode;
  detail?: string;
  
  detailTitle?: string;
  
  leading?: ReactNode;
  
  trailing?: ReactNode;
  onOpenDetails?: () => void;
  expanded: boolean;
  
  onToggle?: () => void;
  
  toggleLabel?: string;
}) {
  const { intl } = useCfIntl();
  const openLabel = intl.formatMessage({ id: "chat.toolCall.workflow.openRunDetails" });
  const toggleLabel =
    toggleLabelOverride ??
    intl.formatMessage({
      id: expanded ? "chat.toolCall.collapseDetails" : "chat.toolCall.expandDetails",
    });
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2 text-ui-base"
      data-testid="workflow-card-header"
    >
      {WORKFLOW_CARD_ICON}
      {}
      <span className="shrink-0 whitespace-nowrap font-medium" data-testid="workflow-card-kind">
        <span className="wf-swap" key={typeof kind === "string" ? kind : undefined}>
          <span className={live ? "animated-gradient-text" : "text-foreground"}>{kind}</span>
        </span>
      </span>
      <span
        className="min-w-20 flex-1 truncate text-foreground-subtle"
        data-testid="workflow-card-name"
        title={name}
      >
        {name}
      </span>
      {}
      <span className="ml-auto flex min-w-0 items-center gap-2">
        {leading}
        {status}
        {detail === undefined || detail.length === 0 ? null : (
          <span
            className="min-w-0 truncate text-ui-base tabular-nums text-foreground-subtlest"
            data-testid="workflow-card-detail"
            {...(detailTitle === undefined ? {} : { title: detailTitle })}
          >
            {detail}
          </span>
        )}
        {trailing}
        {onOpenDetails === undefined ? null : (
          <ControlHintTooltip title={openLabel} side="top">
            <Button
              aria-label={openLabel}
              data-testid="workflow-card-open-details"
              onClick={onOpenDetails}
              size="icon-md"
              type="button"
              variant="ghost"
            >
              <Maximize2Icon className="size-3.5" />
            </Button>
          </ControlHintTooltip>
        )}
        {onToggle === undefined ? null : (
          <Button
            aria-expanded={expanded}
            aria-label={toggleLabel}
            data-testid="workflow-card-toggle"
            onClick={onToggle}
            size="icon-md"
            type="button"
            variant="ghost"
          >
            <ChevronRightIcon
              className={cn("size-4 transition-transform", expanded && "rotate-90")}
            />
          </Button>
        )}
      </span>
    </div>
  );
}

export function WorkflowCardFooter({
  parts = [],
  status,
  trailing,
}: {
  status: WorkflowRunState["status"];
  
  parts?: readonly string[];
  trailing?: ReactNode;
}) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-foreground-subtle"
      data-testid="workflow-card-footer"
    >
      <WorkflowRunStatus status={status} />
      {parts.length > 0 ? (
        <>
          <ListIcon aria-hidden className="size-3.5 shrink-0 text-foreground-subtlest" />
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 tabular-nums">
            {parts.map((part, i) => (
              <span className="flex items-center gap-x-2" key={i}>
                {i > 0 ? (
                  <span aria-hidden className="text-foreground-subtlest">
                    ·
                  </span>
                ) : null}
                <span>{part}</span>
              </span>
            ))}
          </span>
        </>
      ) : null}
      {trailing}
    </div>
  );
}
