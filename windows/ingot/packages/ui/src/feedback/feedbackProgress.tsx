import type { FeedbackTicketStatus } from "@origin-ai/cf-shared";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";

type Stage = "submitted" | "reviewing" | "in_progress" | "done";

const STAGES: { key: Stage; label: string }[] = [
  { key: "submitted", label: "feedback.progress.stage.submitted" },
  { key: "reviewing", label: "feedback.progress.stage.reviewing" },
  { key: "in_progress", label: "feedback.progress.stage.inProgress" },
  { key: "done", label: "feedback.progress.stage.done" },
];

function statusToStage(status: FeedbackTicketStatus): {
  current: Stage;
  rejected: boolean;
} {
  switch (status) {
    case "Submitted":
      return { current: "submitted", rejected: false };
    case "Insufficient Information":
      return { current: "reviewing", rejected: false };
    case "Accepted":
    case "In Development":
    case "Resolved":
      return { current: "in_progress", rejected: false };
    case "Launched":
    case "Closed with Reply":
    case "Archived":
      return { current: "done", rejected: false };
    case "Rejected":
      return { current: "done", rejected: true };
    default:
      return { current: "submitted", rejected: false };
  }
}

export function FeedbackProgress({
  status,
  assigneeDisplay,
}: {
  status: FeedbackTicketStatus;
  assigneeDisplay?: string | null;
}) {
  const { intl } = useCfIntl();
  const formatMessage = intl.formatMessage;
  const { current, rejected } = statusToStage(status);
  const currentIdx = STAGES.findIndex((item) => item.key === current);
  const assigneeLabel = assigneeDisplay
    ? formatMessage({ id: "feedback.progress.assignee.dev" })
    : formatMessage({ id: "feedback.progress.assignee.unassigned" });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-ui-base text-foreground-subtle">
        <span className="font-medium">
          {formatMessage({ id: "feedback.progress.title" })}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-foreground-subtle">
          <span>{formatMessage({ id: "feedback.progress.currentHandler" })}</span>
          <span className="font-medium text-foreground">{assigneeLabel}</span>
        </span>
      </div>
      <ol className="grid grid-cols-4 gap-2">
        {STAGES.map((stage, idx) => {
          const reached = idx <= currentIdx;
          const isCurrent = idx === currentIdx && !rejected;
          const isRejected = rejected && idx === currentIdx;
          return (
            <li key={stage.key} className="flex flex-col gap-1.5">
              <span
                className={cn(
                  "h-1.5 w-full rounded-full transition-colors",
                  isRejected
                    ? "bg-destructive/70"
                    : reached
                      ? isCurrent
                        ? "bg-primary"
                        : "bg-primary/65"
                      : "bg-border",
                )}
              />
              <span
                className={cn(
                  "text-ui-xs leading-tight",
                  isRejected
                    ? "text-destructive"
                    : isCurrent
                      ? "font-medium text-primary"
                      : reached
                        ? "text-foreground"
                        : "text-foreground-subtle",
                )}
              >
                {isRejected && stage.key === "done"
                  ? formatMessage({ id: "feedback.progress.stage.closed" })
                  : formatMessage({ id: stage.label })}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
