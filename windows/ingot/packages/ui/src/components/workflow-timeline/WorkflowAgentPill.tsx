import type { CSSProperties, ReactNode } from "react";
import {
  ArrowUpRightIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
  LoaderCircleIcon,
  TerminalIcon,
} from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { LaneClass, StepRunStatus } from "@/components/workflow-graph/types.js";
import { WorkflowAgentFace, agentColor } from "@/components/workflow-timeline/WorkflowAgentFace.js";

export { agentColor, avatarColor } from "@/components/workflow-timeline/WorkflowAgentFace.js";

export function LaneGlyph({
  laneClass,
  className,
  avatarIndex,
  name,
  status,
}: {
  laneClass: LaneClass;
  className?: string;
  name: string;
  avatarIndex?: number | undefined;
  status?: StepRunStatus | undefined;
}) {
  if (laneClass === "agent") {
    return (
      <WorkflowAgentFace
        avatarIndex={avatarIndex}
        className={className}
        name={name}
        status={status}
      />
    );
  }
  const Glyph = laneClass === "workspace" ? TerminalIcon : CircleHelpIcon;
  return <Glyph aria-hidden className={className} />;
}

export function PillStatusMark({ status }: { status: StepRunStatus | undefined }) {
  const { intl } = useCfIntl();
  if (status === undefined || status === "pending") return null;
  const label = intl.formatMessage({ id: `chat.toolCall.workflow.graph.status.${status}` });
  return (
    <span
      aria-label={label}
      className={cn(
        "wf-mark flex size-3.5 shrink-0 items-center justify-center",
        status === "running" && "text-foreground-subtle",
        status === "done" && "text-foreground-subtle",
        status === "failed" && "text-destructive",
      )}
      data-testid="workflow-pill-status"
      key={status}
      role="img"
      title={label}
    >
      {status === "running" ? (
        <LoaderCircleIcon
          aria-hidden
          className="size-3.5 animate-spin motion-reduce:animate-none"
        />
      ) : status === "done" ? (
        <CircleCheckIcon aria-hidden className="size-3.5" />
      ) : (
        <CircleXIcon aria-hidden className="size-3.5" />
      )}
    </span>
  );
}

export interface WorkflowAgentPillOpen {
  onOpen: () => void;
  label: string;
  testId?: string;
  data?: Record<`data-${string}`, string>;
}

export function WorkflowAgentPill({
  children,
  avatarIndex,
  className,
  enterDelayMs,
  inertTitle,
  laneClass,
  name,
  open,
  size = "md",
  status,
  title,
  trailing,
}: {
  avatarIndex?: number | undefined;
  
  enterDelayMs?: number;
  
  name: string;
  laneClass: LaneClass;
  status: StepRunStatus | undefined;
  title?: string;
  className?: string;
  
  open?: WorkflowAgentPillOpen;
  
  inertTitle?: string;
  
  children?: ReactNode;
  
  trailing?: ReactNode;
  
  size?: "md" | "row";
}) {
  const tinted = laneClass === "agent";
  const style = {
    ...(tinted ? { "--wf-avatar": agentColor(avatarIndex, name) } : {}),
    ...(enterDelayMs === undefined || enterDelayMs <= 0
      ? {}
      : { animationDelay: `${enterDelayMs}ms`, animationFillMode: "backwards" as const }),
  } as CSSProperties;
  const settled = status !== undefined && status !== "pending";
  const hasMark = settled;
  const hasTail = hasMark || open !== undefined;
  const Root = open === undefined ? "span" : "button";
  const body = (
    <>
      <LaneGlyph
        laneClass={laneClass}
        name={name}
        avatarIndex={avatarIndex}
        status={status}
        className={cn(
          "shrink-0",
          size === "row" ? "size-3.5" : "size-4",
          tinted ? "text-[var(--wf-avatar)]" : "text-foreground-subtle",
        )}
      />
      <span
        className={cn(
          "wf-pill-name min-w-0 flex-1 truncate",
          settled ? "text-foreground" : "text-foreground-subtle",
        )}
      >
        {name}
      </span>
      {children}
      {hasTail ? (
        <span
          className="wf-pill-tail grid size-3.5 shrink-0 place-items-center [&>*]:col-start-1 [&>*]:row-start-1"
          data-testid="workflow-pill-tail"
        >
          <PillStatusMark status={status} />
          {open === undefined ? null : (
            <span
              aria-hidden
              className="wf-pill-go flex size-3.5 items-center justify-center text-foreground-subtlest"
              data-testid={open.testId ?? "workflow-pill-open"}
              {...open.data}
            >
              <ArrowUpRightIcon className="size-3.5" />
            </span>
          )}
        </span>
      ) : null}
      {trailing}
    </>
  );
  return (
    <Root
      aria-label={open?.label}
      className={cn(
        "wf-pill wf-agent-pill wf-arrive flex rounded-full min-w-0 items-center",
        size === "row"
          ? "h-6 gap-1.5 pl-1 pr-1.5 text-ui-sm"
          : "h-8 gap-2 bg-surface pl-2 pr-2.5 text-ui-sm",
        open !== undefined &&
          "wf-pill-open cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
      data-agent-open={open === undefined ? undefined : "true"}
      data-agent-status={status ?? "pending"}
      data-pill-size={size}
      data-testid="workflow-agent-pill"
      onClick={open?.onOpen}
      style={style}
      title={open === undefined ? (inertTitle ?? title ?? name) : (title ?? name)}
      {...(open === undefined ? {} : { type: "button" as const })}
    >
      {body}
    </Root>
  );
}
