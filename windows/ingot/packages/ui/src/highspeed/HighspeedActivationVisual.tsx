import { memo, useCallback, useEffect, useState } from "react";
import { FloatingParticles } from "@/components/ui/floating-particles.js";
import { HighSpeedDiffusionCanvas } from "@/v4/highspeed/HighSpeedDiffusionCanvas.js";

type HighspeedVisualPhase = "diffusing" | "handoff" | "stable";

const HIGHSPEED_HANDOFF_FALLBACK_MS = 1_000;

export const HighspeedComposerBackground = memo(function HighspeedComposerBackground({
  animated,
  onModelTransitionStart,
}: {
  
  animated: boolean;
  onModelTransitionStart: () => void;
}) {
  const [phase, setPhase] = useState<HighspeedVisualPhase>(animated ? "diffusing" : "stable");
  const handleHandoffStart = useCallback(() => setPhase("handoff"), []);
  const handleDiffusionComplete = useCallback(() => setPhase("stable"), []);

  useEffect(() => {
    if (phase !== "handoff") return;
    const fallbackTimer = window.setTimeout(handleDiffusionComplete, HIGHSPEED_HANDOFF_FALLBACK_MS);
    return () => window.clearTimeout(fallbackTimer);
  }, [handleDiffusionComplete, phase]);

  return (
    <div
      data-testid="highspeed-composer-background"
      data-phase={phase}
      aria-hidden="true"
      className="highspeed-composer-background pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      {phase !== "stable" ? (
        <HighSpeedDiffusionCanvas
          onModelTransitionStart={onModelTransitionStart}
          onHandoffStart={handleHandoffStart}
          onComplete={handleDiffusionComplete}
        />
      ) : null}
      <FloatingParticles className="highspeed-particle-layer z-0" settled={!animated} />
    </div>
  );
});
