import { type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";

export function WorkflowRunSectionToggle({
  expanded,
  label,
  onToggle,
  testId,
  title,
  trailing,
}: {
  expanded: boolean;
  
  label: string;
  onToggle: () => void;
  testId: string;
  title: string;
  
  trailing?: ReactNode;
}) {
  return (
    <button
      aria-expanded={expanded}
      aria-label={label}
      className="flex w-full items-center gap-1.5 px-4 py-2 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40"
      data-testid={testId}
      onClick={onToggle}
      type="button"
    >
      <ChevronRightIcon
        className={cn(
          "size-3.5 shrink-0 text-foreground-subtlest transition-transform",
          expanded ? "rotate-90" : undefined,
        )}
      />
      <span className="min-w-0 flex-1 truncate text-ui-xs font-medium text-foreground-subtle">
        {title}
      </span>
      {trailing}
    </button>
  );
}
