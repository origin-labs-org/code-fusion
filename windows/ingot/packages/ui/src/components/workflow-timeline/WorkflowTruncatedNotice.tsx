import { workflowRunStepCounts, type WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";

export function WorkflowTruncatedNotice({
  className,
  run,
  testId,
}: {
  className?: string;
  
  run: WorkflowRunState | undefined;
  testId: string;
}) {
  const { intl } = useCfIntl();
  if (run?.truncated !== true) return null;
  const shown = run.nodes.length;
  const { total } = workflowRunStepCounts(run);
  if (shown >= total) return null;
  return (
    <p
      className={cn("min-w-0 text-ui-xs text-foreground-subtlest", className)}
      data-testid={testId}
    >
      {}
      {intl.formatMessage({ id: "chat.toolCall.workflow.run.truncated" }, { shown, total })}
    </p>
  );
}
