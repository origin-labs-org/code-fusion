import { MessageCircleQuestion } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { ToolSnapshotFieldNotice } from "@/ToolCallBlocks/ToolSnapshotFieldNotice.js";
import { ToolLayout } from "@/ToolCallBlocks/ToolLayout.js";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";

const ESCALATE_TOOL_ICON = (
  <MessageCircleQuestion className="size-4 shrink-0 text-foreground-subtle" />
);

const INLINE_PREVIEW_MAX_LENGTH = 160;

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function toInlinePreview(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const collapsed = value.replace(/\s+/gu, " ").trim();
  if (collapsed.length === 0) return undefined;
  return collapsed.length > INLINE_PREVIEW_MAX_LENGTH
    ? `${collapsed.slice(0, INLINE_PREVIEW_MAX_LENGTH)}…`
    : collapsed;
}

export function EscalateToolCallBlock(context: ToolCallBlockRenderContext) {
  const { intl } = useCfIntl();
  const { toolCall } = context.toolCallNode;
  const input = toRecord(toolCall.input);
  const question = readText(input?.question);
  const questionContext = readText(input?.context);

  const isFailed = toolCall.status === "failed";
  const isAsking =
    !isFailed &&
    (context.isRunning || toolCall.status === "pending" || toolCall.status === "in_progress");

  const answerText = isAsking ? undefined : readText(toolCall.output);

  const kindLabel = intl.formatMessage({
    id: isAsking
      ? "chat.toolCall.workflow.escalate.asking"
      : "chat.toolCall.workflow.escalate.asked",
  });
  const questionHeading = intl.formatMessage({ id: "chat.toolCall.workflow.escalate.question" });
  const contextHeading = intl.formatMessage({ id: "chat.toolCall.workflow.escalate.context" });
  const answerHeading = intl.formatMessage({ id: "chat.toolCall.workflow.escalate.answer" });
  const fallbackName = intl.formatMessage({ id: "chat.toolCall.workflow.escalate.fallbackName" });

  const inlinePreview = useMemo(() => toInlinePreview(question), [question]);
  const primaryText = useMemo(
    () => (
      <span className="min-w-0 truncate">{inlinePreview ?? toolCall.title ?? fallbackName}</span>
    ),
    [inlinePreview, toolCall.title, fallbackName],
  );

  const hasDetails =
    question !== undefined || questionContext !== undefined || answerText !== undefined;

  const renderContent = useCallback(
    () => (
      <div className="space-y-3">
        {question !== undefined ? (
          <section className="space-y-1.5">
            <h4 className="text-ui-sm font-medium text-foreground-subtlest">{questionHeading}</h4>
            <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-panel px-4 py-3 text-ui-base leading-5 text-foreground">
              {question}
            </p>
          </section>
        ) : null}
        {questionContext !== undefined ? (
          <section className="space-y-1.5">
            <h4 className="text-ui-sm font-medium text-foreground-subtlest">{contextHeading}</h4>
            <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-panel px-4 py-3 text-ui-base leading-5 text-foreground-subtle">
              {questionContext}
            </p>
          </section>
        ) : null}
        {answerText !== undefined ? (
          <section className="space-y-1.5">
            <h4 className="text-ui-sm font-medium text-foreground-subtlest">{answerHeading}</h4>
            <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-panel px-4 py-3 text-ui-base leading-5 text-foreground">
              {answerText}
            </p>
          </section>
        ) : null}
      </div>
    ),
    [question, questionContext, answerText, questionHeading, contextHeading, answerHeading],
  );

  return (
    <>
      <ToolLayout
        toolId={toolCall.toolId}
        icon={ESCALATE_TOOL_ICON}
        showIcon={context.showIcon !== false}
        canToggle={hasDetails && (context.canToggle ?? true)}
        forceOpen={hasDetails && (context.forceOpen ?? false)}
        hideSecondaryTextWhenOpen
        kindLabel={kindLabel}
        sourceLabel={context.sourceLabel}
        primaryText={primaryText}
        statusLabel={
          isFailed ? intl.formatMessage({ id: "chat.toolCall.status.failed" }) : undefined
        }
        statusTooltip={isFailed ? context.errorText : undefined}
        showFailureStatus={isFailed}
        isRunning={context.isRunning}
        title={toolCall.title}
        renderContent={hasDetails ? renderContent : undefined}
      />
      <ToolSnapshotFieldNotice
        refs={toolCall.snapshotRefs ?? []}
        onLoadFullToolCallFields={
          context.onLoadFullToolCallFields
            ? () => context.onLoadFullToolCallFields?.(toolCall.toolId)
            : undefined
        }
      />
    </>
  );
}
