import { useMemo, type ReactNode } from "react";
import type { ToolCallCreateWorkflowDisplay } from "@origin-ai/cf-shared/cf-protocol-v4";
import { CodeBlock, CodeBlockHeader } from "@/components/ai-elements/code-block.js";
import { cn } from "@/components/lib/utils.js";
import { DRAFT_FEEDBACK_DOT } from "@/components/workflow-graph/run-status-presentation.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { WorkflowDraftPosition } from "@/ToolCallBlocks/shared.js";
import {
  formatWorkflowFeedbackTooltip,
  workflowDiagnosticLines,
} from "@/ToolCallBlocks/renderers/createWorkflowDisplay.js";
import {
  WorkflowDiagnosticsSection,
  workflowFeedbackLedeMessageId,
} from "@/ToolCallBlocks/renderers/workflow-diagnostics.js";

interface WorkflowDraftRowSlots {
  
  secondaryText: ReactNode | undefined;
  
  statusLabel: ReactNode | undefined;
  
  statusIndicator: ReactNode | undefined;
  
  statusTooltip: string | undefined;
  
  inFlightOrdinalText: string | undefined;
}

interface WorkflowDraftRowInput {
  draft: WorkflowDraftPosition | undefined;
  compileErrors: boolean;
  
  inFlight: boolean;
  errorCount: number;
  diagnostics: readonly { line: number; column: number; message: string }[];
  saved: boolean;
}

export function useWorkflowDraftRowSlots({
  draft,
  compileErrors,
  inFlight,
  errorCount,
  diagnostics,
  saved,
}: WorkflowDraftRowInput): WorkflowDraftRowSlots {
  const { intl } = useCfIntl();
  const ordinal = workflowDraftOrdinalShown(draft, { compileErrors, inFlight });
  const inFlightOrdinal = workflowDraftOrdinalShown(draft, { compileErrors: false, inFlight });
  const inFlightOrdinalText =
    inFlightOrdinal === undefined
      ? undefined
      : intl.formatMessage(
          { id: "chat.toolCall.workflow.draftOrdinal" },
          { ordinal: String(inFlightOrdinal) },
        );
  const superseded = draft?.superseded === true;
  const lede = intl.formatMessage({ id: workflowFeedbackLedeMessageId(saved) });
  const words = compileErrors
    ? `${intl.formatMessage({ id: "chat.toolCall.workflow.toFix" }, { count: errorCount })} · ${intl.formatMessage({ id: "chat.toolCall.workflow.notRun" })}`
    : undefined;

  const secondaryText = useMemo(
    () => (ordinal === undefined ? undefined : <WorkflowDraftOrdinal ordinal={ordinal} />),
    [ordinal],
  );
  const statusLabel = useMemo(
    () =>
      words === undefined ? undefined : <span data-testid="workflow-draft-status">{words}</span>,
    [words],
  );
  const statusIndicator = useMemo(
    () => (compileErrors ? <WorkflowDraftLamp superseded={superseded} /> : undefined),
    [compileErrors, superseded],
  );
  const statusTooltip = useMemo(
    () => (compileErrors ? formatWorkflowFeedbackTooltip(lede, diagnostics) : undefined),
    [compileErrors, diagnostics, lede],
  );
  return { secondaryText, statusLabel, statusIndicator, statusTooltip, inFlightOrdinalText };
}

export function WorkflowFeedbackContent({
  display,
  fallbackOutputText,
  saved,
  scriptText,
}: {
  display: ToolCallCreateWorkflowDisplay | null;
  fallbackOutputText: string | null;
  saved: boolean;
  scriptText: string | undefined;
}) {
  const flaggedLines = useMemo(
    () => (display?.ok === false ? workflowDiagnosticLines(display.diagnostics) : undefined),
    [display],
  );
  return (
    <div className="mb-2 space-y-3">
      {scriptText ? (
        <div data-testid="workflow-script-codeblock">
          <CodeBlock
            className="border border-border bg-card"
            contentClassName="max-h-80 overflow-auto"
            code={scriptText}
            language="typescript"
            showLineNumbers
            {...(flaggedLines === undefined ? {} : { markedLines: flaggedLines })}
          >
            <CodeBlockHeader className="pl-3 pr-2 pt-2" language="typescript" />
          </CodeBlock>
        </div>
      ) : null}
      {display && display.diagnostics.length > 0 ? (
        <WorkflowDiagnosticsSection
          count={display.errorCount}
          diagnostics={display.diagnostics}
          saved={saved}
          truncated={display.truncated}
        />
      ) : null}
      {!display && fallbackOutputText ? (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-panel px-3 py-2 font-mono text-ui-base text-foreground-subtle">
          {fallbackOutputText}
        </pre>
      ) : null}
    </div>
  );
}

export function workflowDraftOrdinalShown(
  draft: WorkflowDraftPosition | undefined,
  phase: { compileErrors: boolean; inFlight: boolean },
): number | undefined {
  if (draft === undefined) return undefined;
  if (phase.compileErrors) return draft.ordinal;
  return phase.inFlight && draft.ordinal >= 2 ? draft.ordinal : undefined;
}

export function WorkflowDraftOrdinal({ ordinal }: { ordinal: number }) {
  const { intl } = useCfIntl();
  return (
    <span className="shrink-0 whitespace-nowrap tabular-nums" data-testid="workflow-draft-ordinal">
      {intl.formatMessage(
        { id: "chat.toolCall.workflow.draftOrdinal" },
        { ordinal: String(ordinal) },
      )}
    </span>
  );
}

export function WorkflowDraftLamp({ superseded }: { superseded: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "wf-lamp size-2 shrink-0 rounded-full",
        superseded ? DRAFT_FEEDBACK_DOT.settled : DRAFT_FEEDBACK_DOT.open,
      )}
      data-draft-lamp={superseded ? "settled" : "open"}
      data-testid="workflow-draft-lamp"
    />
  );
}
