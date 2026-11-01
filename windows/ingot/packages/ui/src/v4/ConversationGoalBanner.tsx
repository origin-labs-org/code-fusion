import { memo } from "react";
import { TID_V4_GOAL_BANNER } from "@origin-ai/cf-shared/test-ids";
import type { GoalState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { useCfIntl } from "@/i18n/IntlProvider.js";

export interface ConversationGoalBannerProps {
  goal: GoalState;
}

function ConversationGoalBannerImpl({ goal }: ConversationGoalBannerProps) {
  const { intl } = useCfIntl();
  return (
    <div
      data-testid={TID_V4_GOAL_BANNER}
      data-goal-status={goal.status}
      data-goal-objective={goal.objective}
      className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-ui-sm"
    >
      <span className="text-[var(--color-foreground-subtle)]">
        {intl.formatMessage({ id: "chat.goalBanner.label" })}
      </span>
      <span className="min-w-0 flex-1 truncate text-[var(--color-foreground)]">
        {goal.objective}
      </span>
      <span className="shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-foreground-subtle)]">
        {goal.status} · #{goal.iteration}
      </span>
    </div>
  );
}

export const ConversationGoalBanner = memo(ConversationGoalBannerImpl);
