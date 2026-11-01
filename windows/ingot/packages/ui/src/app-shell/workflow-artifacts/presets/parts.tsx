

import type { ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";

export type PresetLabels = {
  
  otherColumn: string;
  
  empty: string;
  
  itemsCount: (count: number) => string;
};

export const REVEAL_ANIMATION_CLASS =
  "animate-in fade-in duration-300 ease-out motion-reduce:animate-none";

export function PresetEmpty({ label, compact }: { label: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg border border-dashed border-border text-foreground-subtlest",
        compact ? "px-2 py-3 text-ui-xs" : "px-4 py-8 text-ui-sm",
      )}
      data-testid="artifact-preset-empty"
    >
      {label}
    </div>
  );
}

export function fieldHeading(label: string, unit?: string): string {
  return unit ? `${label} (${unit})` : label;
}

export function PresetHeading({
  title,
  description,
  trailing,
  className,
}: {
  title?: string;
  description?: string;
  trailing?: ReactNode;
  className?: string;
}) {
  if (!title && !description && !trailing) {
    return null;
  }
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {title ? (
          <div className="truncate text-ui-base font-medium text-foreground">{title}</div>
        ) : null}
        {description ? (
          <div className="mt-0.5 text-ui-sm text-foreground-subtle">{description}</div>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
