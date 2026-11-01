import { Hourglass, MessageCircleQuestion, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BackgroundResultOriginMeta,
  WorkflowBlockedMeta,
  WorkflowNotificationMeta,
  WorkflowRunHole,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { CodeBlock, CodeBlockHeader } from "@/components/ai-elements/code-block.js";
import { WorkflowNotificationHoleRow } from "@/v4/WorkflowNotificationHoleRow.js";
import { ToolLayout } from "@/ToolCallBlocks/ToolLayout.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { Theme } from "@/useTheme.js";
import { workflowRunQuestionWaitedLabel } from "@/app-shell/workflowRunQuestions.js";
import { WorkflowNotificationArtifactChips } from "@/v4/WorkflowNotificationArtifactChips.js";

const TID_CHAT_WORKFLOW_NOTIFICATION_ROW = "chat-workflow-notification-row";

const INLINE_PREVIEW_MAX_LENGTH = 160;

const TERMINAL_ICON = <Workflow className="size-4 shrink-0 text-foreground-subtle" />;
const ESCALATION_ICON = (
  <MessageCircleQuestion className="size-4 shrink-0 text-foreground-subtle" />
);

const PANEL_CLASS =
  "whitespace-pre-wrap break-words rounded-lg border border-border bg-panel px-4 py-3 text-ui-base leading-5";

const ERROR_PANEL_CLASS =
  "whitespace-pre-wrap break-words rounded-lg border border-destructive/40 bg-panel px-4 py-3 text-ui-base leading-5 text-foreground";

function toInlinePreview(value: string): string | undefined {
  const collapsed = value.replace(/\s+/gu, " ").trim();
  if (collapsed.length === 0) return undefined;
  return collapsed.length > INLINE_PREVIEW_MAX_LENGTH
    ? `${collapsed.slice(0, INLINE_PREVIEW_MAX_LENGTH)}…`
    : collapsed;
}

const TERMINAL_KIND_LABEL_ID: Record<"completed" | "errored" | "stopped", string> = {
  completed: "chat.backgroundResult.workflow.completed",
  errored: "chat.backgroundResult.workflow.errored",
  stopped: "chat.backgroundResult.workflow.stopped",
};

const STALL_KIND_LABEL_ID = "chat.backgroundResult.workflow.stall";
const STALL_ICON = <Hourglass className="size-4 shrink-0 text-foreground-subtle" />;

const BLOCKED_KIND_LABEL_ID = "chat.backgroundResult.workflow.blocked";

function factLine(label: string, value: string, key: string) {
  return (
    <p key={key} className="text-ui-sm text-foreground-subtle">
      <span className="text-foreground-subtlest">{label}</span> {value}
    </p>
  );
}

function escalationState(
  pendingQids: ReadonlySet<string> | undefined,
  qid: string,
): "waiting" | "answered" | "asked" {
  if (pendingQids === undefined) return "asked";
  return pendingQids.has(qid) ? "waiting" : "answered";
}

export type WorkflowRowNotification =
  | WorkflowNotificationMeta
  | ({ kind: "blocked" } & WorkflowBlockedMeta);

export function workflowRowNotification(
  originMeta: BackgroundResultOriginMeta | undefined,
): WorkflowRowNotification | undefined {
  if (originMeta?.backgroundSource !== "workflow") return undefined;
  if (originMeta.workflowNotification) return originMeta.workflowNotification;
  return originMeta.workflowBlocked
    ? { kind: "blocked", ...originMeta.workflowBlocked }
    : undefined;
}

export interface WorkflowNotificationToolRowProps {
  notification: WorkflowRowNotification;
  
  runName: string;
  
  testIdKey: string;
  
  theme: Theme;
  
  onOpenRun?: () => void;
  
  onOpenArtifact?: (artifactId: string) => void;
  
  pendingQids?: ReadonlySet<string>;
  
  forceOpen?: boolean;
  
  holes?: readonly WorkflowRunHole[];
}

export function WorkflowNotificationToolRow(props: WorkflowNotificationToolRowProps) {
  if (props.notification.kind === "hole") {
    return (
      <WorkflowNotificationHoleRow
        forceOpen={props.forceOpen ?? false}
        holes={props.holes}
        notification={props.notification}
        runName={props.runName}
        toolId={`${TID_CHAT_WORKFLOW_NOTIFICATION_ROW}-${props.testIdKey}`}
        {...(props.onOpenRun === undefined ? {} : { onOpenRun: props.onOpenRun })}
      />
    );
  }
  return <WorkflowNotificationBaseRow {...props} notification={props.notification} />;
}

function WorkflowNotificationBaseRow({
  notification,
  runName,
  testIdKey,
  theme,
  onOpenRun,
  onOpenArtifact,
  pendingQids,
  forceOpen = false,
}: WorkflowNotificationToolRowProps & {
  notification: Exclude<WorkflowRowNotification, { kind: "hole" }>;
}) {
  const { intl } = useCfIntl();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const openRunLink = onOpenRun ? (
    <button
      type="button"
      onClick={onOpenRun}
      className="text-ui-sm text-foreground-subtle decoration-dotted underline-offset-2 hover:text-foreground hover:underline"
    >
      {intl.formatMessage({ id: "chat.toolCall.workflow.openRunDetails" })}
    </button>
  ) : null;

  const isEscalation = notification.kind === "escalation";
  const isStall = notification.kind === "stall";
  const isBlocked = notification.kind === "blocked";

  const escalationView = isEscalation ? escalationState(pendingQids, notification.qid) : undefined;

  const stopReason =
    notification.kind === "terminal" && notification.status === "stopped"
      ? notification.stopReason
      : undefined;
  const kindLabel = isEscalation
    ? intl.formatMessage({ id: `chat.backgroundResult.workflow.${escalationView!}` })
    : isStall
      ? intl.formatMessage({ id: STALL_KIND_LABEL_ID })
      : notification.kind === "blocked"
        ? intl.formatMessage({ id: BLOCKED_KIND_LABEL_ID })
        : stopReason !== undefined
          ? `${intl.formatMessage({ id: TERMINAL_KIND_LABEL_ID[notification.status] })} · ${intl.formatMessage({ id: `chat.toolCall.workflow.run.stopReason.${stopReason}` })}`
          : intl.formatMessage({ id: TERMINAL_KIND_LABEL_ID[notification.status] });

  const primaryText = useMemo(() => {
    if (notification.kind !== "escalation") {
      return (
        <span className="inline-flex min-w-0 items-center gap-2">
          <span aria-hidden>·</span>
          <span className="min-w-0 truncate">{runName}</span>
        </span>
      );
    }
    const preview = toInlinePreview(notification.question);
    return <span className="min-w-0 truncate">{preview ?? runName}</span>;
  }, [notification, runName]);

  const artifactChips =
    notification.kind === "terminal" &&
    notification.artifacts !== undefined &&
    notification.artifacts.length > 0 ? (
      <span className="inline-flex min-w-0 items-center gap-2">
        <span aria-hidden>·</span>
        <WorkflowNotificationArtifactChips
          artifacts={notification.artifacts}
          {...(notification.artifactsTruncated === undefined
            ? {}
            : { truncated: notification.artifactsTruncated })}
          {...(onOpenArtifact === undefined ? {} : { onOpenArtifact })}
        />
      </span>
    ) : undefined;

  const hasDetails =
    notification.kind !== "terminal"
      ? true
      : notification.error !== undefined
        ? true
        : Boolean(notification.result);

  const waited =
    escalationView === "waiting" && notification.kind === "escalation"
      ? workflowRunQuestionWaitedLabel(notification.askedAt, now, (descriptor, values) =>
          intl.formatMessage(descriptor, values),
        )
      : undefined;

  const renderContent = useCallback(() => {
    if (notification.kind === "escalation") {
      const contextHeading = intl.formatMessage({ id: "chat.toolCall.workflow.escalate.context" });
      return (
        <div className="space-y-3">
          {}
          <p className={`${PANEL_CLASS} text-foreground`}>{notification.question}</p>
          {notification.context !== undefined ? (
            <section className="space-y-1.5">
              <h4 className="text-ui-sm font-medium text-foreground-subtlest">{contextHeading}</h4>
              <p className={`${PANEL_CLASS} text-foreground-subtle`}>{notification.context}</p>
            </section>
          ) : null}
          {waited ? <p className="text-ui-sm text-foreground-subtle">{waited}</p> : null}
          {openRunLink}
        </div>
      );
    }

    if (notification.kind === "stall") {
      const minutes = Math.max(1, Math.round(notification.sinceMs / 60_000));
      return (
        <div className="space-y-1" data-testid="workflow-notification-stall">
          <p className={`${PANEL_CLASS} text-foreground`}>
            {intl.formatMessage({ id: "chat.backgroundResult.workflow.stall.body" }, { minutes })}
          </p>
          {notification.reason !== undefined
            ? factLine(
                intl.formatMessage({ id: "chat.backgroundResult.workflow.stall.reason" }),
                notification.reason,
                "reason",
              )
            : null}
          {notification.cap !== undefined
            ? factLine(
                intl.formatMessage({ id: "chat.backgroundResult.workflow.stall.cap" }),
                String(notification.cap),
                "cap",
              )
            : null}
          {openRunLink}
        </div>
      );
    }

    if (notification.kind === "blocked") {
      const minutes = Math.max(1, Math.round(notification.sinceMs / 60_000));
      const facts = [
        ...(notification.questions > 0
          ? [
              intl.formatMessage(
                {
                  id:
                    notification.questions === 1
                      ? "chat.toolCall.workflow.digest.question"
                      : "chat.toolCall.workflow.digest.questions",
                },
                { count: notification.questions },
              ),
            ]
          : []),
        ...(notification.holes > 0
          ? [
              intl.formatMessage(
                {
                  id:
                    notification.holes === 1
                      ? "chat.toolCall.workflow.card.hole"
                      : "chat.toolCall.workflow.card.holes",
                },
                { count: notification.holes },
              ),
            ]
          : []),
        intl.formatMessage({ id: "chat.backgroundResult.workflow.blocked.openFor" }, { minutes }),
      ];
      return (
        <div className="space-y-1" data-testid="workflow-notification-blocked">
          <p className="text-ui-sm text-foreground-subtle">{facts.join(" · ")}</p>
          {openRunLink}
        </div>
      );
    }

    if (notification.error !== undefined) {
      return (
        <div className="space-y-3">
          <p className={ERROR_PANEL_CLASS}>{notification.error}</p>
          {openRunLink}
        </div>
      );
    }

    const { result, resultForm } = notification;
    let resultCode = result ?? "";
    if (resultForm === "json") {
      try {
        resultCode = JSON.stringify(JSON.parse(resultCode), null, 2);
      } catch {
        
      }
    }
    return (
      <div className="mb-2 min-w-0 space-y-2" data-testid="workflow-notification-result">
        {resultForm === "json" ? (
          <CodeBlock
            appTheme={theme}
            code={resultCode}
            language="json"
            className="border border-border bg-card"
            contentClassName="max-h-80 overflow-auto"
            wrapLongLines
          >
            <CodeBlockHeader className="pl-3 pr-2 pt-2" language="json" />
          </CodeBlock>
        ) : (
          <p className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-ui-base leading-relaxed text-foreground">
            {result}
          </p>
        )}
        {openRunLink}
      </div>
    );
  }, [notification, theme, waited, openRunLink, intl]);

  const toolId = `${TID_CHAT_WORKFLOW_NOTIFICATION_ROW}-${testIdKey}`;

  return (
    <div data-testid={toolId}>
      <ToolLayout
        toolId={toolId}
        persistOpenKey={toolId}
        icon={isEscalation ? ESCALATION_ICON : isStall || isBlocked ? STALL_ICON : TERMINAL_ICON}
        canToggle={hasDetails}
        forceOpen={forceOpen && hasDetails}
        hideSecondaryTextWhenOpen
        kindLabel={kindLabel}
        primaryText={primaryText}
        secondaryText={artifactChips}
        title={runName}
        renderContent={hasDetails ? renderContent : undefined}
      />
    </div>
  );
}
