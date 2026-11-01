import { useCfIntl } from "@/i18n/IntlProvider.js";

interface WorkflowDiagnosticEntry {
  line: number;
  column: number;
  code: number;
  message: string;
}

const ANALYZER_RULE_CODE_MIN = 9001;
const ANALYZER_RULE_CODE_MAX = 9099;

export function isWorkflowAnalyzerRuleCode(code: number): boolean {
  return code >= ANALYZER_RULE_CODE_MIN && code <= ANALYZER_RULE_CODE_MAX;
}

export function workflowFeedbackLedeMessageId(saved: boolean): string {
  return saved
    ? "chat.toolCall.workflow.feedback.lede.saved"
    : "chat.toolCall.workflow.feedback.lede";
}

export function WorkflowDiagnosticsSection({
  diagnostics,
  truncated,
  count,
  saved = false,
}: {
  diagnostics: readonly WorkflowDiagnosticEntry[];
  truncated?: boolean;
  
  count?: number;
  
  saved?: boolean;
}) {
  const { intl } = useCfIntl();
  if (diagnostics.length === 0) {
    return null;
  }

  const total = count ?? diagnostics.length;
  const countLabel = intl.formatMessage(
    {
      id:
        total === 1
          ? "chat.toolCall.workflow.feedback.countOne"
          : "chat.toolCall.workflow.feedback.count",
    },
    { count: total },
  );
  const codeLabel = (code: number) =>
    isWorkflowAnalyzerRuleCode(code)
      ? intl.formatMessage({ id: "chat.toolCall.workflow.feedback.rule" }, { code: String(code) })
      : `TS${code}`;

  return (
    <div
      className="flex flex-col gap-1.5 rounded-xl border border-border bg-panel px-3 py-2"
      data-testid="workflow-compiler-feedback"
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2 text-ui-xs font-medium text-foreground-subtle">
        <span className="min-w-0 truncate" data-testid="workflow-compiler-feedback-title">
          {intl.formatMessage({ id: "chat.toolCall.workflow.feedback" })}
        </span>
        <span
          className="shrink-0 font-normal tabular-nums"
          data-testid="workflow-compiler-feedback-count"
        >
          {countLabel}
        </span>
      </div>
      <p
        className="text-ui-sm text-foreground-subtle"
        data-testid="workflow-compiler-feedback-lede"
      >
        {intl.formatMessage({ id: workflowFeedbackLedeMessageId(saved) })}
      </p>
      {diagnostics.map((diagnostic, index) => (
        <div
          key={`${diagnostic.line}:${diagnostic.column}:${index}`}
          className="flex items-start gap-2 text-ui-base"
          data-testid="workflow-compiler-feedback-line"
        >
          <code className="shrink-0 rounded-sm bg-surface px-1.5 py-0.5 font-mono text-ui-xs text-foreground-subtle">
            L{diagnostic.line}:C{diagnostic.column}
          </code>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground">
            {diagnostic.message}
          </span>
          <code className="shrink-0 font-mono text-ui-xs text-foreground-subtlest">
            {codeLabel(diagnostic.code)}
          </code>
        </div>
      ))}
      {truncated ? (
        <p className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "chat.toolCall.workflow.truncated" })}
        </p>
      ) : null}
    </div>
  );
}
