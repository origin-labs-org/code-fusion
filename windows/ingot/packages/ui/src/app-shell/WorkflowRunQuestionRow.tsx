import { MessageCircleQuestionIcon } from "lucide-react";
import type { WorkflowRunPendingQuestion } from "@origin-ai/cf-shared/cf-protocol-v4";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { workflowRunQuestionWaitedLabel } from "@/app-shell/workflowRunQuestions.js";

export function WorkflowRunQuestionRow({
  className,
  now,
  question,
  showAsker = false,
}: {
  
  className?: string;
  
  now: number;
  question: WorkflowRunPendingQuestion;
  
  showAsker?: boolean;
}) {
  const { intl } = useCfIntl();
  const waited = workflowRunQuestionWaitedLabel(question.askedAt, now, (descriptor, values) =>
    intl.formatMessage(descriptor, values),
  );

  return (
    <div
      className={cn(
        "mt-1 flex min-w-0 items-start gap-2 rounded-lg bg-[var(--color-interaction-confirmation-surface)] px-2 py-1.5 text-ui-sm text-[var(--color-interaction-confirmation-foreground)]",
        className,
      )}
      data-qid={question.qid}
      data-testid="workflow-run-question"
    >
      <MessageCircleQuestionIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {showAsker ? (
          <span className="mr-2 font-mono text-ui-xs font-medium">
            {question.actorName ??
              (question.actorSiteId === undefined
                ? intl.formatMessage({ id: "chat.toolCall.workflow.graph.lane.anonymous" })
                : `${question.actorSiteId}@${question.actorOrdinal}`)}
          </span>
        ) : null}
        {}
        <span className="whitespace-pre-wrap break-words">{question.question}</span>
        {question.context === undefined ? null : (
          <p
            className="mt-0.5 whitespace-pre-wrap break-words text-ui-xs opacity-80"
            data-testid="workflow-run-question-context"
          >
            {question.context}
          </p>
        )}
      </div>
      <span className="flex shrink-0 items-baseline gap-2 font-mono text-ui-xs">
        {}
        {waited === undefined ? null : (
          <span data-testid="workflow-run-question-waited">{waited}</span>
        )}
        <span className="opacity-70">{question.qid}</span>
      </span>
    </div>
  );
}
