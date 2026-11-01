import { useCallback, type KeyboardEvent } from "react";
import { TID_AUTOMATIONS_PAGE_TAB } from "@origin-ai/cf-shared";
import { testId } from "@origin-ai/cf-shared/test-ids";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";

export type AutomationsPageTab = "automation" | "workflow";

export const AUTOMATIONS_PAGE_TABS: readonly AutomationsPageTab[] = ["automation", "workflow"];

export function AutomationsPageTitle({
  workflowTabEnabled,
  value,
  onValueChange,
}: {
  workflowTabEnabled: boolean;
  value: AutomationsPageTab;
  onValueChange: (tab: AutomationsPageTab) => void;
}) {
  const { intl } = useCfIntl();
  if (!workflowTabEnabled) {
    return (
      <h1 className="text-[30px] font-medium leading-[34px] tracking-[0.114px] text-foreground">
        {intl.formatMessage({ id: "settings.automations.title" })}
      </h1>
    );
  }
  return <AutomationsPageTitleSwitch value={value} onValueChange={onValueChange} />;
}

export function AutomationsPageTitleSwitch({
  value,
  onValueChange,
}: {
  value: AutomationsPageTab;
  onValueChange: (tab: AutomationsPageTab) => void;
}) {
  const { intl } = useCfIntl();
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const index = AUTOMATIONS_PAGE_TABS.indexOf(value);
      const next =
        AUTOMATIONS_PAGE_TABS[
          (index + (event.key === "ArrowRight" ? 1 : -1) + AUTOMATIONS_PAGE_TABS.length) %
            AUTOMATIONS_PAGE_TABS.length
        ]!;
      onValueChange(next);
    },
    [onValueChange, value],
  );

  return (
    <div
      role="tablist"
      aria-label={intl.formatMessage({ id: "automations.pageTab.ariaLabel" })}
      className="flex items-baseline gap-5"
      onKeyDown={handleKeyDown}
    >
      {AUTOMATIONS_PAGE_TABS.map((tab) => {
        const active = tab === value;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            data-testid={testId(TID_AUTOMATIONS_PAGE_TAB, tab)}
            onClick={() => onValueChange(tab)}
            className={cn(
              "rounded-md text-[30px] font-medium leading-[34px] tracking-[0.114px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused",
              active ? "text-foreground" : "text-foreground-subtle hover:text-foreground",
            )}
          >
            {intl.formatMessage({ id: `automations.pageTab.${tab}` })}
          </button>
        );
      })}
    </div>
  );
}
