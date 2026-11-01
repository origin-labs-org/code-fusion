import { useEffect, useState, type RefObject } from "react";
import type { AgentPointer } from "#ui/shell/state.ts";

export interface OffscreenTargets {
  indexes: number[];
  down: boolean;
}

export function useOffscreenTargets(
  canvasRef: RefObject<HTMLDivElement | null>,
  agent: AgentPointer | null,
) {
  const [offscreen, setOffscreen] = useState<OffscreenTargets | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !agent || agent.targets.length < 2) {
      setOffscreen(null);
      return;
    }
    let frame = 0;
    const check = () => {
      frame = 0;
      const bounds = canvas.getBoundingClientRect();
      const below: number[] = [];
      const above: number[] = [];
      agent.targets.forEach((target, i) => {
        if (i === agent.index) return;
        const box = target.locate();
        if (!box) return;
        if (box.top > bounds.bottom - 8) below.push(i);
        else if (box.bottom < bounds.top + 8) above.push(i);
      });
      const next = below.length
        ? { indexes: below, down: true }
        : above.length
          ? { indexes: above, down: false }
          : null;
      setOffscreen((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    canvas.addEventListener("scroll", schedule, { capture: true, passive: true });
    const settle = setInterval(schedule, 500);
    return () => {
      canvas.removeEventListener("scroll", schedule, { capture: true });
      clearInterval(settle);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [agent, canvasRef]);
  return [offscreen, setOffscreen] as const;
}
