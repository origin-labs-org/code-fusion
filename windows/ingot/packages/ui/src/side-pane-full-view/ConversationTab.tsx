import { MessageCircleIcon } from "lucide-react";
import { TID_SIDE_PANE_FULL_VIEW_CONVERSATION_TAB } from "@origin-ai/cf-shared/test-ids";
import { cn } from "@/components/lib/utils.js";
import { TabsTrigger } from "@/components/ui/tabs.js";

export const SIDE_PANE_FULL_VIEW_CONVERSATION_TAB_VALUE = "__side-pane-full-view-conversation__";

export function SidePaneFullViewConversationTab({
  title,
  isActive,
}: {
  title: string;
  isActive: boolean;
}) {
  return (
    <TabsTrigger value={SIDE_PANE_FULL_VIEW_CONVERSATION_TAB_VALUE} asChild>
      <div
        title={title}
        data-testid={TID_SIDE_PANE_FULL_VIEW_CONVERSATION_TAB}
        data-active={isActive ? "" : undefined}
        data-state={isActive ? "active" : "inactive"}
        className={cn(
          "group relative inline-flex shrink-0 items-center gap-1.5",
          "!h-7 max-w-60 justify-start overflow-hidden rounded-lg border px-1.5 pr-2 text-ui-base font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring",
          "!border-transparent !bg-transparent text-foreground-subtle hover:text-foreground",
          !isActive && "hover:!bg-hover",
          "data-active:!bg-selected data-active:text-foreground",
          "cursor-default",
          "[app-region:no-drag]",
        )}
      >
        <MessageCircleIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{title}</span>
      </div>
    </TabsTrigger>
  );
}
