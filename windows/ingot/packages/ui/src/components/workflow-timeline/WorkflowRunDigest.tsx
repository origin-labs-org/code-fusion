import { useMemo, useState } from "react";
import {
  MessageCircleQuestionIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  SquareIcon,
} from "lucide-react";
import { TID_CHAT_WORKFLOW_RUN_DIGEST } from "@origin-ai/cf-shared";
import { testId } from "@origin-ai/cf-shared/test-ids";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { WorkflowRunCardSummary } from "@/ToolCallBlocks/fileSummaryTypes.js";
import type { HoleLabels } from "./timeline-holes.js";
import { buildWorkflowTimeline, type TimelinePill } from "./timeline-model.js";
import { workflowCardDetail } from "./timeline-summary.js";
import { HolesWaitingChip } from "./WorkflowHoleParts.js";
import {
  WORKFLOW_RUN_ENDED_KIND_ID,
  WorkflowCardHeader,
  workflowRunKindMessageId,
} from "./WorkflowCardChrome.js";
import { WorkflowArtifactStrip } from "./WorkflowArtifactStrip.js";
import {
  useWorkflowRunSettingsPopoverState,
  WorkflowRunSettingsPopover,
  type WorkflowRunSettingsHost,
} from "./WorkflowRunSettingsPopover.js";
import { timelineHeight, WorkflowTimeline } from "./WorkflowTimeline.js";
import { WorkflowTruncatedNotice } from "./WorkflowTruncatedNotice.js";

export interface WorkflowRunDigestProps {
  name: string;
  runId: string;
  
  graph: WorkflowCausalityGraphData | undefined;
  
  holeLabels?: HoleLabels;
  
  summary: WorkflowRunCardSummary | undefined;
  
  pendingQuestions?: number;
  
  onOpenRun?: (landing?: { phaseId: string }) => void;
  
  onResume?: () => void;
  
  onCancel?: () => void;
  
  onOpenPill?: (pill: TimelinePill) => void;
  
  onOpenWorkspace?: (pill: TimelinePill) => void;
  
  onOpenArtifact?: (artifactId: string) => void;
  
  subagentModelProviderName?: (providerId: string) => string | undefined;
  
  settingsHost?: WorkflowRunSettingsHost;
  
  testIdKey: string;
}

export function WorkflowRunDigest({
  graph,
  holeLabels,
  name,
  onOpenArtifact,
  onOpenPill,
  onOpenRun,
  onOpenWorkspace,
  onResume,
  onCancel,
  pendingQuestions = 0,
  runId,
  settingsHost,
  subagentModelProviderName,
  summary,
  testIdKey,
}: WorkflowRunDigestProps) {
  const { intl } = useCfIntl();
  const run = summary?.run;
  const [expanded, setExpanded] = useState(true);

  const model = useMemo(
    () =>
      graph !== undefined && graph.steps.length > 0 && run !== undefined
        ? buildWorkflowTimeline(graph, run, holeLabels)
        : undefined,
    [graph, holeLabels, run],
  );
  const hasRail = model !== undefined && model.stations.length > 0;
  const shown = useMemo(
    () =>
      expanded || !model
        ? model
        : {
            ...model,
            stations: model.stations.map((station) => ({ ...station, pills: [] })),
          },
    [expanded, model],
  );
  const hitsControl = (target: EventTarget | null, root: HTMLElement) => {
    const control =
      target instanceof Element
        ? target.closest("button, a, input, textarea, select, [role='button']")
        : null;
    return control !== null && control !== root;
  };

  const format = intl.formatMessage.bind(intl);
  const cardDetail = workflowCardDetail(format, model, graph, run, subagentModelProviderName);
  const live = summary?.status === "running";
  const kind = format({
    id: summary === undefined ? WORKFLOW_RUN_ENDED_KIND_ID : workflowRunKindMessageId(summary),
  });
  const questionsLabel =
    pendingQuestions > 0
      ? format(
          {
            id:
              pendingQuestions === 1
                ? "chat.toolCall.workflow.digest.question"
                : "chat.toolCall.workflow.digest.questions",
          },
          { count: pendingQuestions },
        )
      : undefined;
  const questions =
    questionsLabel === undefined ? undefined : onOpenRun === undefined ? (
      <span
        className="wf-arrive flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--color-warning)_12%,transparent)] py-0.5 pl-1.5 pr-2 text-ui-xs font-medium text-warning"
        data-testid="workflow-digest-questions"
      >
        <MessageCircleQuestionIcon aria-hidden className="size-3" />
        {questionsLabel}
      </span>
    ) : (
      <button
        className="wf-arrive flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--color-warning)_12%,transparent)] py-0.5 pl-1.5 pr-2 text-ui-xs font-medium text-warning outline-none transition-colors hover:bg-[color-mix(in_oklab,var(--color-warning)_20%,transparent)] focus-visible:ring-2 focus-visible:ring-ring/40"
        data-testid="workflow-digest-questions"
        onClick={() => onOpenRun()}
        type="button"
      >
        <MessageCircleQuestionIcon aria-hidden className="size-3" />
        {questionsLabel}
      </button>
    );
  const holesWaiting = (run?.holes ?? []).filter((hole) => hole.state === "waiting").length;
  const leading =
    questions === undefined && holesWaiting === 0 ? undefined : (
      <>
        {questions}
        <HolesWaitingChip
          count={holesWaiting}
          {...(onOpenRun === undefined ? {} : { onOpen: () => onOpenRun() })}
        />
      </>
    );
  const resume =
    summary?.resumable === true && onResume !== undefined ? (
      <Button
        data-testid="workflow-digest-resume"
        onClick={onResume}
        size="default"
        type="button"
        variant="outline"
      >
        <RotateCcwIcon className="size-3.5" />
        {format({ id: "chat.toolCall.workflow.run.resume" })}
      </Button>
    ) : undefined;
  const cancel =
    live && onCancel !== undefined ? (
      <CancelRunButton key={summary?.status} onCancel={onCancel} />
    ) : undefined;
  const configure =
    settingsHost !== undefined && run !== undefined ? (
      <ConfigureRunButton host={settingsHost} run={run} />
    ) : undefined;

  return (
    <section
      aria-label={kind}
      className={cn(
        "wf-motion wf-arrive flex w-full min-w-0 flex-col gap-1 rounded-xl border border-border/70 bg-card/70 px-3.5 pb-2 pt-1.5 outline-none",
        hasRail && "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/40",
      )}
      data-expanded={hasRail ? String(expanded) : undefined}
      data-testid={testId(TID_CHAT_WORKFLOW_RUN_DIGEST, testIdKey)}
      data-workflow-run-digest="true"
      data-workflow-run-id={runId}
      data-workflow-run-status={summary?.status ?? "absent"}
      role={hasRail ? "button" : undefined}
      tabIndex={hasRail ? 0 : undefined}
      aria-expanded={hasRail ? expanded : undefined}
      onClick={(event) => {
        if (hasRail && !hitsControl(event.target, event.currentTarget))
          setExpanded((value) => !value);
      }}
      onKeyDown={(event) => {
        if (
          !hasRail ||
          hitsControl(event.target, event.currentTarget) ||
          (event.key !== "Enter" && event.key !== " ")
        )
          return;
        event.preventDefault();
        setExpanded((value) => !value);
      }}
    >
      <WorkflowCardHeader
        detail={cardDetail?.detail}
        {...(cardDetail?.title === undefined ? {} : { detailTitle: cardDetail.title })}
        expanded={expanded}
        kind={kind}
        leading={leading}
        live={live}
        name={name}
        trailing={
          configure === undefined ? (
            (resume ?? cancel)
          ) : (
            <>
              {configure}
              {resume ?? cancel}
            </>
          )
        }
        {...(onOpenRun === undefined ? {} : { onOpenDetails: () => onOpenRun() })}
      />
      {shown === undefined || !hasRail ? null : (
        <div
          className={cn("wf-digest-plot overflow-hidden")}
          data-testid="workflow-digest-plot"
          style={{ height: timelineHeight(shown) + 8 }}
        >
          <WorkflowTimeline
            className="py-1"
            model={shown}
            {...(onOpenPill === undefined ? {} : { onOpenPill })}
            {...(onOpenWorkspace === undefined ? {} : { onOpenWorkspace })}
            {...(onOpenRun === undefined
              ? {}
              : {
                  onOpenMore: (station) => onOpenRun({ phaseId: station.id }),
                  onOpenFill: (fill) => {
                    const first = shown.stations[fill.from];
                    if (first !== undefined) onOpenRun({ phaseId: first.id });
                  },
                })}
          />
        </div>
      )}
      {}
      {hasRail ? <WorkflowTruncatedNotice run={run} testId="workflow-digest-truncated" /> : null}
      {}
      {run?.artifacts !== undefined && run.artifacts.length > 0 ? (
        <WorkflowArtifactStrip
          artifacts={run.artifacts}
          className="pb-0.5 pt-0.5"
          moreTestId="workflow-digest-artifacts-more"
          pillTestId="workflow-digest-artifact"
          testId="workflow-digest-artifacts"
          {...(onOpenArtifact === undefined ? {} : { onOpenArtifact })}
        />
      ) : null}
    </section>
  );
}

function ConfigureRunButton({
  host,
  run,
}: {
  host: WorkflowRunSettingsHost;
  run: WorkflowRunState;
}) {
  const { intl } = useCfIntl();
  const { anchorRef, open, setOpen, toggleFrom } = useWorkflowRunSettingsPopoverState();
  const label = intl.formatMessage({ id: "chat.toolCall.workflow.run.settings.title" });
  return (
    <>
      <ControlHintTooltip title={label} side="top">
        <Button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={label}
          data-testid="workflow-digest-configure"
          onClick={(event) => toggleFrom(event.currentTarget)}
          size="icon-md"
          type="button"
          variant="ghost"
        >
          <SlidersHorizontalIcon className="size-3.5" />
        </Button>
      </ControlHintTooltip>
      <WorkflowRunSettingsPopover
        anchorRef={anchorRef}
        host={host}
        onOpenChange={setOpen}
        open={open}
        run={run}
      />
    </>
  );
}

function CancelRunButton({ onCancel }: { onCancel: () => void }) {
  const { intl } = useCfIntl();
  const [cancelling, setCancelling] = useState(false);
  const label = intl.formatMessage({
    id: cancelling ? "chat.toolCall.workflow.run.cancelling" : "chat.toolCall.workflow.run.cancel",
  });
  return (
    <ControlHintTooltip
      title={label}
      side="top"
      {...(cancelling
        ? {}
        : {
            description: intl.formatMessage({ id: "chat.toolCall.workflow.run.stopHint" }),
          })}
    >
      <Button
        aria-label={label}
        data-testid="workflow-digest-cancel"
        disabled={cancelling}
        onClick={() => {
          setCancelling(true);
          onCancel();
        }}
        size="icon-md"
        type="button"
        variant="ghost"
      >
        <SquareIcon className="size-3.5 fill-current" />
      </Button>
    </ControlHintTooltip>
  );
}
