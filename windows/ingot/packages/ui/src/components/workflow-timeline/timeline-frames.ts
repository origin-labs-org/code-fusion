import type { TimelineStation } from "./timeline-model.js";
import { fillContains, type HoleParents, type TimelineFill } from "./timeline-holes.js";
import {
  HEAD_ROW,
  MARK_X,
  RAIL_ROW,
  STATION_WIDTH,
  stationX,
  type TimelineLayout,
} from "./timeline-geometry.js";

export const FRAME_OUTSET = 8;

export const FRAME_NEST_INSET = 4;

export const FRAME_RADIUS = 8;

export const FRAME_LEGEND_GAP = 4;

export interface FrameBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  start?: number;
}

export interface TimelineFrame {
  holeId: string;
  box: FrameBox;
  
  filledAt?: number;
}

export function framePath(box: FrameBox, radius = FRAME_RADIUS): string {
  const x0 = box.x0 + 0.5;
  const y0 = box.y0 + 0.5;
  const x1 = box.x1 - 0.5;
  const y1 = box.y1 - 0.5;
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2));
  const start = Math.min(Math.max(box.start ?? x0 + r, x0 + r), x1 - r);
  return [
    `M${start},${y0}`,
    `H${x1 - r}`,
    `Q${x1},${y0} ${x1},${y0 + r}`,
    `V${y1 - r}`,
    `Q${x1},${y1} ${x1 - r},${y1}`,
    `H${x0 + r}`,
    `Q${x0},${y1} ${x0},${y1 - r}`,
    `V${y0 + r}`,
    `Q${x0},${y0} ${x0 + r},${y0}`,
    `H${start}`,
  ].join(" ");
}

export interface FillMark {
  holeId: string;
  index: number;
  filledAt?: number;
}

export function fillMarksOf(
  stations: readonly Pick<TimelineStation, "hole">[],
  fills: readonly Pick<TimelineFill, "holeId">[],
): FillMark[] {
  const headed = new Set(fills.map((fill) => fill.holeId));
  return stations.flatMap((station, index) => {
    const hole = station.hole;
    if (hole?.state !== "filled" || headed.has(hole.siteId)) return [];
    return [
      {
        holeId: hole.siteId,
        index,
        ...(hole.filledAt === undefined ? {} : { filledAt: hole.filledAt }),
      },
    ];
  });
}

function sameStartDepth(
  fill: TimelineFill,
  fills: readonly TimelineFill[],
  parents: HoleParents,
): number {
  return fills.filter(
    (other) =>
      other.holeId !== fill.holeId &&
      other.from === fill.from &&
      fillContains(other.holeId, fill.holeId, parents),
  ).length;
}

export function fillDepthOf(
  holeId: string,
  fills: readonly Pick<TimelineFill, "holeId">[],
  parents: HoleParents,
): number {
  return fills.filter(
    (other) => other.holeId !== holeId && fillContains(other.holeId, holeId, parents),
  ).length;
}

export function timelineFrames({
  columnHeight,
  fills,
  height,
  inset,
  layout,
  parents,
  stations,
  width,
}: {
  fills: readonly TimelineFill[];
  stations: readonly Pick<TimelineStation, "hole" | "track">[];
  layout: Pick<TimelineLayout, "pillsTop" | "rowY">;
  
  columnHeight: (index: number) => number;
  height: number;
  width: number;
  inset: number;
  parents: HoleParents;
}): TimelineFrame[] {
  const bottomOf = (from: number, to: number): number => {
    let tallest = 0;
    for (let i = from; i <= to; i += 1) tallest = Math.max(tallest, columnHeight(i));
    return tallest > 0 ? layout.pillsTop + tallest + FRAME_OUTSET : layout.pillsTop - 4;
  };
  const clamp = (box: FrameBox): FrameBox => ({
    ...box,
    x0: Math.max(0, box.x0),
    x1: Math.min(width, box.x1),
    y0: Math.max(0, box.y0),
    y1: Math.min(height, box.y1),
  });
  const frames: TimelineFrame[] = fills.map((fill) => {
    const k = sameStartDepth(fill, fills, parents) * FRAME_NEST_INSET;
    return {
      holeId: fill.holeId,
      box: clamp({
        x0: stationX(fill.from, inset) - FRAME_OUTSET + k,
        x1: stationX(fill.to, inset) + STATION_WIDTH + FRAME_OUTSET - k,
        y0: HEAD_ROW / 2,
        y1: bottomOf(fill.from, fill.to) - k,
        start: stationX(fill.from, inset) + MARK_X,
      }),
      ...(fill.filledAt === undefined ? {} : { filledAt: fill.filledAt }),
    };
  });
  for (const mark of fillMarksOf(stations, fills)) {
    const rowY = layout.rowY[stations[mark.index]?.track ?? 0] ?? layout.rowY[0]!;
    frames.push({
      holeId: mark.holeId,
      box: clamp({
        x0: stationX(mark.index, inset) - FRAME_OUTSET,
        x1: stationX(mark.index, inset) + STATION_WIDTH + FRAME_OUTSET,
        y0: rowY - RAIL_ROW / 2 - 4,
        y1: bottomOf(mark.index, mark.index),
      }),
      ...(mark.filledAt === undefined ? {} : { filledAt: mark.filledAt }),
    });
  }
  return frames;
}

export function legendGaps(
  rows: readonly { left: number; width: number }[],
): { x: number; width: number }[] {
  return rows
    .filter((row) => row.width > 0)
    .map((row) => ({ x: row.left - FRAME_LEGEND_GAP, width: row.width + 2 * FRAME_LEGEND_GAP }));
}

export const SPINE_FRAME_LEFT = 8;
export const SPINE_FRAME_RIGHT = 12;
export const SPINE_RAIL_X = 21;

export function spineFrameBox({
  bottom,
  depth,
  headed,
  top,
  width,
}: {
  
  top: number;
  
  bottom: number;
  width: number;
  depth: number;
  headed: boolean;
}): FrameBox {
  const k = depth * FRAME_NEST_INSET;
  return headed
    ? {
        x0: SPINE_FRAME_LEFT + k,
        x1: width - SPINE_FRAME_RIGHT - k,
        y0: Math.round(top + HEAD_ROW / 2),
        y1: Math.round(bottom + 4),
        start: SPINE_RAIL_X,
      }
    : {
        x0: SPINE_FRAME_LEFT + k,
        x1: width - SPINE_FRAME_RIGHT - k,
        y0: Math.round(top + 2),
        y1: Math.round(bottom - 2),
      };
}
