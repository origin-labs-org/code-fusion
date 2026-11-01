import { arcLaneCount } from "./timeline-bands.js";
import type { TimelineArc, TimelineBand, TimelineStation } from "./timeline-model.js";

export const STATION_WIDTH = 168;
export const STATION_GAP = 24;
export const STATION_PITCH = STATION_WIDTH + STATION_GAP;

export const MARK_X = 17;

export const RAIL_ROW = 24;

export const ARC_LANE = 14;

export const ARC_BASE = 26;

export const TERMINAL_PITCH = 10;
export const PILL_HEIGHT = 32;
export const PILL_GAP = 6;

export const PLATFORM_ROW = 24;

export const CAPTION_X = 12;

export const FORK_BACK = 16;

export const MERGE_BACK = 10;

export const TAIL = 4;
export const STUB = 6;

export const HEAD_ROW = 24;

export const TAIL_STUB = 40;

export function timelineWidth(count: number, inset = 0, tail = false): number {
  return count === 0
    ? 0
    : (count - 1) * STATION_PITCH + STATION_WIDTH + inset + (tail ? TAIL_STUB : 0);
}

export function stationX(index: number, inset = 0): number {
  return index * STATION_PITCH + inset;
}

export function lampX(index: number, inset = 0): number {
  return stationX(index, inset) + MARK_X;
}

export function bandForkX(band: Pick<TimelineBand, "from">, inset = 0): number {
  return band.from === 0 ? TAIL : stationX(band.from, inset) - FORK_BACK;
}

export function bandMergeX(band: Pick<TimelineBand, "join" | "to">, inset = 0): number {
  return band.join === undefined
    ? stationX(band.to, inset) + STATION_WIDTH + STUB
    : stationX(band.join, inset) - MERGE_BACK;
}

export function bandAt(bands: readonly TimelineBand[], index: number): TimelineBand | undefined {
  return bands.find((band) => band.from <= index && index <= band.to);
}

export interface ArcEnds {
  inTrack: boolean;
  fromBand: boolean;
  toBand: boolean;
}

export function arcEnds(
  arc: Pick<TimelineArc, "air" | "from" | "to">,
  bands: readonly TimelineBand[],
  stations: readonly Pick<TimelineStation, "track">[],
): ArcEnds {
  const source = bandAt(bands, arc.from);
  const target = bandAt(bands, arc.to);
  const trackOf = (index: number): number => stations[index]?.track ?? 0;
  const inTrack =
    source !== undefined &&
    source === target &&
    trackOf(arc.from) === arc.air &&
    trackOf(arc.to) === arc.air;
  return {
    fromBand: !inTrack && source !== undefined,
    inTrack,
    toBand: !inTrack && target !== undefined,
  };
}

export function arcTerminalOffsets(
  arcs: readonly Pick<TimelineArc, "air" | "from" | "lane" | "to">[],
  bands: readonly TimelineBand[],
  stations: readonly Pick<TimelineStation, "track">[],
): { takeoff: number[]; landing: number[] } {
  const takeoff = arcs.map(() => 0);
  const landing = arcs.map(() => 0);
  interface Terminal {
    arc: number;
    end: "takeoff" | "landing";
    
    side: -1 | 1;
    lane: number;
  }
  const byStation = new Map<number, Terminal[]>();
  const add = (station: number, terminal: Terminal): void => {
    const list = byStation.get(station) ?? [];
    list.push(terminal);
    byStation.set(station, list);
  };
  arcs.forEach((arc, j) => {
    const ends = arcEnds(arc, bands, stations);
    if (!ends.fromBand) {
      add(arc.from, { arc: j, end: "takeoff", lane: arc.lane, side: arc.to > arc.from ? 1 : -1 });
    }
    if (!ends.toBand) {
      add(arc.to, { arc: j, end: "landing", lane: arc.lane, side: arc.from > arc.to ? 1 : -1 });
    }
  });
  for (const list of byStation.values()) {
    list.sort(
      (left, right) =>
        left.side - right.side || (left.side < 0 ? left.lane - right.lane : right.lane - left.lane),
    );
    list.forEach((terminal, k) => {
      const offset = (k - (list.length - 1) / 2) * TERMINAL_PITCH;
      if (terminal.end === "takeoff") takeoff[terminal.arc] = offset;
      else landing[terminal.arc] = offset;
    });
  }
  return { landing, takeoff };
}

export interface TimelineLayout {
  
  rowY: number[];
  
  capY: number;
  
  pillsTop: number;
  
  inset: number;
  
  banded: boolean;
}

export function timelineLayout(
  arcs: readonly TimelineArc[],
  bands: readonly TimelineBand[],
  
  heads = false,
): TimelineLayout {
  const banded = bands.length > 0;
  const tracks = banded ? Math.max(2, ...bands.map((band) => band.tracks.length)) : 1;
  const rowY: number[] = [];
  let y = heads ? HEAD_ROW : 0;
  for (let t = tracks - 1; t >= 0; t -= 1) {
    const lanes = arcLaneCount(arcs.filter((arc) => arc.air === t));
    const air =
      lanes === 0
        ? t === tracks - 1
          ? 6
          : 0
        : 8 + ARC_BASE - RAIL_ROW / 2 + ARC_LANE * (lanes - 1);
    y += air;
    rowY[t] = y + RAIL_ROW / 2;
    y += RAIL_ROW;
  }
  const capY = banded ? y + PLATFORM_ROW / 2 : rowY[0]!;
  if (banded) y += PLATFORM_ROW;
  return {
    banded,
    capY,
    inset: banded && bands.some((band) => band.from === 0) ? CAPTION_X : 0,
    pillsTop: y + 8,
    rowY,
  };
}
