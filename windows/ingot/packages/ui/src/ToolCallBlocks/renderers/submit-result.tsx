import { ClipboardCheckIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { CodeBlock } from "@/components/ai-elements/code-block.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { ToolSnapshotFieldNotice } from "@/ToolCallBlocks/ToolSnapshotFieldNotice.js";
import { ToolLayout } from "@/ToolCallBlocks/ToolLayout.js";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";

const SUBMIT_RESULT_TOOL_ICON = (
  <ClipboardCheckIcon className="size-4 shrink-0 text-foreground-subtle" />
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

function normalizeSubmittedResult(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  if (value.trim().length === 0) {
    return value;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed : value;
  } catch {
    return value;
  }
}

function stringifyResult(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function toInlinePreview(value: unknown): string | undefined {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }

  const collapsed = text.replace(/\s+/gu, " ").trim();
  if (collapsed.length === 0) {
    return undefined;
  }

  return collapsed.length > INLINE_PREVIEW_MAX_LENGTH
    ? `${collapsed.slice(0, INLINE_PREVIEW_MAX_LENGTH)}…`
    : collapsed;
}

export function SubmitResultToolCallBlock(context: ToolCallBlockRenderContext) {
  const { intl } = useCfIntl();
  const { toolCall } = context.toolCallNode;
  const input = toRecord(toolCall.input);
  const hasResult = input !== undefined && "result" in input;
  const normalizedResult = useMemo(
    () => (hasResult ? normalizeSubmittedResult(input?.result) : undefined),
    [hasResult, input?.result],
  );
  const isProse = typeof normalizedResult === "string";

  const isRejected = toolCall.status === "failed";
  const isStopped = toolCall.status === "stopped" || toolCall.status === "denied";
  const isSubmitting =
    !isRejected &&
    !isStopped &&
    (context.isRunning || toolCall.status === "pending" || toolCall.status === "in_progress");
  const kindLabelId = isRejected
    ? "chat.toolCall.submitResult.rejected"
    : isStopped
      ? "chat.toolCall.submitResult.stopped"
      : isSubmitting
        ? "chat.toolCall.submitResult.submitting"
        : "chat.toolCall.submitResult.submitted";

  const rejectionText = isRejected
    ? (context.errorText ?? readText(toolCall.error) ?? readText(toolCall.output))
    : undefined;
  const hasDetails = !isRejected && hasResult;

  const resultLabel = intl.formatMessage({ id: "chat.toolCall.submitResult.resultHeading" });
  const inlinePreview = useMemo(
    () => (hasResult ? toInlinePreview(normalizedResult) : undefined),
    [hasResult, normalizedResult],
  );
  const primaryText = useMemo(
    () => (
      <span className="min-w-0 truncate">{inlinePreview ?? toolCall.title ?? "submit_result"}</span>
    ),
    [inlinePreview, toolCall.title],
  );

  const theme = context.theme;
  const renderContent = useCallback(
    () => (
      <div className="space-y-3">
        {hasResult ? (
          <section className="space-y-1.5">
            <h4 className="text-ui-sm font-medium text-foreground-subtlest">{resultLabel}</h4>
            {isProse ? (
              <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-panel px-4 py-3 text-ui-base leading-5 text-foreground">
                {normalizedResult as string}
              </p>
            ) : (
              <div className="max-h-72 overflow-auto rounded-xl border border-border bg-card">
                <CodeBlock
                  appTheme={theme}
                  code={stringifyResult(normalizedResult)}
                  language="json"
                />
              </div>
            )}
          </section>
        ) : null}
      </div>
    ),
    [hasResult, isProse, normalizedResult, resultLabel, theme],
  );

  return (
    <>
      <ToolLayout
        toolId={toolCall.toolId}
        icon={SUBMIT_RESULT_TOOL_ICON}
        showIcon={context.showIcon !== false}
        canToggle={hasDetails && (context.canToggle ?? true)}
        forceOpen={hasDetails && (context.forceOpen ?? false)}
        hideSecondaryTextWhenOpen
        kindLabel={intl.formatMessage({ id: kindLabelId })}
        sourceLabel={context.sourceLabel}
        primaryText={primaryText}
        statusLabel={
          isRejected ? intl.formatMessage({ id: "chat.toolCall.status.failed" }) : undefined
        }
        statusTooltip={isRejected ? rejectionText : undefined}
        showFailureStatus={isRejected}
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
