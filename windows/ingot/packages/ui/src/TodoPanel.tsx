import { useState } from "react";
import type { CfPlanStep } from "@origin-ai/cf-shared";
import { Button } from "@/components/ui/button.js";
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
} from "@/components/ai-elements/plan.js";
import {
  QueueItem,
  QueueItemContent,
  QueueItemIndicator,
  QueueList,
} from "@/components/ai-elements/queue.js";
import {
  ChevronsUpDownIcon,
  ListTodo,
  LoaderIcon,
} from "lucide-react";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { cn } from "./components/lib/utils.js";

const todoStatusIndicatorClasses: Record<CfPlanStep["status"], string> = {
  pending: "text-foreground-subtlest",
  in_progress: "text-foreground",
  completed: "text-success",
};

const todoStatusContentClassesStreaming: Record<CfPlanStep["status"], string> = {
  pending: "text-foreground-subtle",
  in_progress: "animated-gradient-text",
  completed: "text-foreground-subtlest line-through",
};

const todoStatusContentClassesIdle: Record<CfPlanStep["status"], string> = {
  pending: "text-foreground-subtle",
  in_progress: "text-foreground",
  completed: "text-foreground-subtlest line-through",
};

export function TodoPanel({
  plan,
  isStreaming,
}: {
  plan: CfPlanStep[] | null;
  isStreaming: boolean;
}) {
  const { intl } = useCfIntl();
  const [isOpen, setIsOpen] = useState(false);

  if (!plan || plan.length === 0) {
    return null;
  }

  const completedCount = plan.filter(
    (step) => step.status === "completed",
  ).length;
  const isAllCompleted = completedCount === plan.length;
  if (isAllCompleted) {
    return null;
  }

  const visiblePlan = plan.filter((step) => step.status !== "completed");
  const activeStep =
    plan.find((step) => step.status === "in_progress") ??
    plan.find((step) => step.status !== "completed") ??
    plan[plan.length - 1];
  const showLoadingState = isStreaming && !isAllCompleted;
  const todoStatusContentClasses = isStreaming
    ? todoStatusContentClassesStreaming
    : todoStatusContentClassesIdle;
  const toggleLabel = intl.formatMessage({ id: "todo.panel.toggle" });
  const toggleOpen = () => setIsOpen((current) => !current);

  return (
    <Plan
      className="gap-0 overflow-hidden rounded-none border-0 bg-popover py-0"
      open={isOpen}
      onOpenChange={setIsOpen}
      isStreaming={isStreaming}
    >
      {}
      <PlanHeader
        className={cn(
          "group flex items-center gap-3 px-4 !py-3",
          isOpen && "!pb-1",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center">
          <button
            type="button"
            aria-expanded={isOpen}
            className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-3 rounded-md p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
            onClick={toggleOpen}
          >
            {isOpen ? (
              <>
                <ListTodo className="size-4 shrink-0 text-foreground" />
                <PlanTitle className="min-w-0 truncate text-ui-base font-medium text-foreground">
                  {intl.formatMessage({ id: "todo.panel.title" })}
                </PlanTitle>
                <PlanDescription className="shrink-0 text-ui-base font-mono text-foreground-subtlest">
                  {`${completedCount}/${plan.length}`}
                </PlanDescription>
              </>
            ) : showLoadingState ? (
              <>
                <LoaderIcon className="size-4 shrink-0 animate-spin text-foreground" />
                <PlanTitle className="animated-gradient-text min-w-0 truncate text-ui-base font-medium">
                  {activeStep?.title ??
                    intl.formatMessage({ id: "todo.panel.currentTask" })}
                </PlanTitle>
              </>
            ) : (
              <>
                <ListTodo className="size-4 shrink-0 text-foreground" />
                <PlanTitle className="min-w-0 truncate text-ui-base font-medium text-foreground">
                  {activeStep?.title ??
                    intl.formatMessage({ id: "todo.panel.currentTask" })}
                </PlanTitle>
              </>
            )}
            {!isOpen ? (
              <PlanDescription className="shrink-0 text-ui-base font-mono text-foreground-subtle">
                {`${completedCount}/${plan.length}`}
              </PlanDescription>
            ) : null}
          </button>
        </div>
        <PlanAction className="shrink-0">
          <ControlHintTooltip
            title={intl.formatMessage({
              id: isOpen ? "chat.longRunning.collapse" : "chat.longRunning.expand",
            })}
          >
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-expanded={isOpen}
              aria-label={toggleLabel}
              onClick={(event) => {
                event.stopPropagation();
                toggleOpen();
              }}
            >
              <ChevronsUpDownIcon className="size-4" />
              <span className="sr-only">{toggleLabel}</span>
            </Button>
          </ControlHintTooltip>
        </PlanAction>
      </PlanHeader>
      <PlanContent className="p-1">
        <QueueList className="mt-0">
          {visiblePlan.map((step) => (
            <QueueItem
              key={step.id}
              className="gap-0 w-full rounded-xl px-3 py-2 hover:bg-hover/30"
            >
              <div className="flex min-w-0 items-center gap-3">
                <QueueItemIndicator
                  className={todoStatusIndicatorClasses[step.status]}
                  status={step.status}
                />
                <QueueItemContent
                  className={`min-w-0 line-clamp-none ${todoStatusContentClasses[step.status]}`}
                  completed={false}
                >
                  {step.title}
                </QueueItemContent>
              </div>
            </QueueItem>
          ))}
        </QueueList>
      </PlanContent>
    </Plan>
  );
}
