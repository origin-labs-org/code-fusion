import { useEffect, useState, type CSSProperties } from "react";
import { STATION_PITCH } from "./timeline-geometry.js";
import type { WorkflowTimelineModel } from "./timeline-model.js";

export const SLIDE_MS = 320;

export interface FillSlide {
  
  after: number;
  
  shift: number;
  
  key: number;
}

interface SeenShape {
  key: string;
  stations: number;
  fills: readonly string[];
}

function shapeOf(model: WorkflowTimelineModel): SeenShape {
  const fills = (model.fills ?? []).map((fill) => fill.holeId);
  return {
    key: `${model.stations.map((station) => station.id).join("\u0000")}\u0001${fills.join("\u0000")}`,
    stations: model.stations.length,
    fills,
  };
}

export function fillGrowth(
  previous: Pick<SeenShape, "stations" | "fills">,
  model: WorkflowTimelineModel,
): Pick<FillSlide, "after" | "shift"> | undefined {
  const grown = (model.fills ?? []).filter((fill) => !previous.fills.includes(fill.holeId));
  const delta = model.stations.length - previous.stations;
  if (grown.length === 0 || delta <= 0) return undefined;
  return { after: Math.max(...grown.map((fill) => fill.to)), shift: delta * STATION_PITCH };
}

export function useFillGrowth(model: WorkflowTimelineModel): FillSlide | undefined {
  const shape = shapeOf(model);
  const [seen, setSeen] = useState(shape);
  const [slide, setSlide] = useState<FillSlide | undefined>(undefined);
  if (seen.key !== shape.key) {
    const growth = fillGrowth(seen, model);
    setSeen(shape);
    if (growth !== undefined) setSlide((current) => ({ ...growth, key: (current?.key ?? 0) + 1 }));
  }
  useEffect(() => {
    if (slide === undefined) return undefined;
    const timer = setTimeout(() => setSlide(undefined), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [slide]);
  return slide;
}

export function slideClass(index: number, slide: FillSlide | undefined): string | undefined {
  return slide !== undefined && index > slide.after ? "wf-slide" : undefined;
}

export function slideStyle(index: number, slide: FillSlide | undefined): CSSProperties {
  return slide !== undefined && index > slide.after
    ? ({ "--wf-slide": `${-slide.shift}px` } as CSSProperties)
    : {};
}
