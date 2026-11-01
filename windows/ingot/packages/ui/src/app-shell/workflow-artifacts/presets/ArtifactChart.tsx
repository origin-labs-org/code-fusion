

import { lazy, Suspense } from "react";
import type { ArtifactItem } from "@/app-shell/workflow-artifacts/presets/apply.js";
import type { PresetLabels } from "@/app-shell/workflow-artifacts/presets/parts.js";
import type { ChartSpec } from "@/app-shell/workflow-artifacts/presets/spec.js";
import { cn } from "@/components/lib/utils.js";
import { ScopedErrorBoundary } from "@/ErrorBoundary.js";

const ArtifactChartView = lazy(
  () => import("@/app-shell/workflow-artifacts/presets/ArtifactChartView.js"),
);

function ChartSkeleton({ compact }: { compact: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "w-full animate-pulse rounded-lg bg-surface motion-reduce:animate-none",
        compact ? "h-14" : "h-56",
      )}
      data-testid="artifact-chart-skeleton"
    />
  );
}

export function ArtifactChart({
  spec,
  items,
  compact = false,
  labels,
  className,
}: {
  spec: ChartSpec;
  items: readonly ArtifactItem[];
  compact?: boolean;
  labels: PresetLabels;
  className?: string;
}) {
  return (
    <ScopedErrorBoundary
      resetKeys={[spec, compact]}
      scope="workflow-artifact-chart"
      variant={compact ? "compact" : "inline"}
    >
      <Suspense fallback={<ChartSkeleton compact={compact} />}>
        <ArtifactChartView
          className={className}
          compact={compact}
          items={items}
          labels={labels}
          spec={spec}
        />
      </Suspense>
    </ScopedErrorBoundary>
  );
}
