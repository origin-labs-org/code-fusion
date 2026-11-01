import type { CSSProperties } from "react";
import { lampX, stationX, STATION_WIDTH } from "./timeline-geometry.js";

export const LEDGE_LAMP = 10;
export const LEDGE_PITCH = 16;
export const LEDGE_PAD = 8;
export const LEDGE_FADE = 40;
export const LEDGE_MAX_LAMPS = 3;

const LEDGE_MORE = 26;

const STUB_MIN = 6;

const THUMB_MIN = 24;

export interface TimelineFold {
  
  left: number[];
  
  right: number[];
}

export const NO_FOLD: TimelineFold = { left: [], right: [] };

export function ledgeWidth(count: number): number {
  if (count <= 0) return 0;
  const lamps = Math.min(count, LEDGE_MAX_LAMPS) * LEDGE_PITCH - (LEDGE_PITCH - LEDGE_LAMP);
  return LEDGE_PAD + lamps + (count > LEDGE_MAX_LAMPS ? LEDGE_MORE : 0) + LEDGE_PAD;
}

export function foldStations(
  count: number,
  scrollLeft: number,
  clientWidth: number,
  keep?: number,
  inset = 0,
): TimelineFold {
  if (count === 0 || clientWidth <= 0) return NO_FOLD;
  const xs = Array.from({ length: count }, (_, i) => lampX(i, inset) - scrollLeft);
  let left: number[] = [];
  let right: number[] = [];
  for (let pass = 0; pass < 8; pass += 1) {
    const lw = left.length === 0 ? 0 : ledgeWidth(left.length) + LEDGE_FADE;
    const rw = right.length === 0 ? 0 : ledgeWidth(right.length) + LEDGE_FADE;
    const nextLeft = xs.flatMap((x, i) => (x < lw && i !== keep ? [i] : []));
    const nextRight = xs.flatMap((x, i) =>
      x > clientWidth - rw && i !== keep && !nextLeft.includes(i) ? [i] : [],
    );
    if (nextLeft.length === left.length && nextRight.length === right.length) break;
    left = nextLeft;
    right = nextRight;
  }
  return left.length === 0 && right.length === 0 ? NO_FOLD : { left, right };
}

export function ledgeLamps(
  indexes: readonly number[],
  side: "left" | "right",
): { shown: number[]; more: number } {
  const more = Math.max(0, indexes.length - LEDGE_MAX_LAMPS);
  const shown =
    more === 0
      ? [...indexes]
      : side === "left"
        ? indexes.slice(more)
        : indexes.slice(0, LEDGE_MAX_LAMPS);
  return { shown, more };
}

export function ledgeStubWidth(
  fold: TimelineFold,
  side: "left" | "right",
  scrollLeft: number,
  clientWidth: number,
  inset = 0,
): number {
  const indexes = side === "left" ? fold.left : fold.right;
  if (indexes.length === 0) return 0;
  const inner = ledgeWidth(indexes.length) - LEDGE_PAD;
  let width: number;
  if (side === "left") {
    const open = indexes[indexes.length - 1]! + 1;
    width = lampX(open, inset) - scrollLeft - STUB_MIN - inner;
  } else {
    const open = indexes[0]! - 1;
    width = clientWidth - inner - (stationX(open, inset) + STATION_WIDTH - scrollLeft);
  }
  return width < STUB_MIN ? 0 : Math.round(width);
}

export interface EdgeOverflow {
  left: boolean;
  right: boolean;
}

export function timelineMaskStyle(
  fold: TimelineFold,
  railBand: number,
  edges: EdgeOverflow,
): CSSProperties | undefined {
  if (!edges.left && !edges.right) return undefined;
  const edgeLeft = edges.left ? `transparent 0px, #000 ${LEDGE_FADE}px` : "#000 0px";
  const edgeRight = edges.right
    ? `#000 calc(100% - ${LEDGE_FADE}px), transparent 100%`
    : "#000 100%";
  const railLeft =
    fold.left.length > 0
      ? `transparent ${ledgeWidth(fold.left.length) + LEDGE_PAD}px, #000 ${ledgeWidth(fold.left.length) + LEDGE_PAD + LEDGE_FADE}px`
      : edgeLeft;
  const railRight =
    fold.right.length > 0
      ? `#000 calc(100% - ${ledgeWidth(fold.right.length) + LEDGE_PAD + LEDGE_FADE}px), transparent calc(100% - ${ledgeWidth(fold.right.length) + LEDGE_PAD}px)`
      : edgeRight;
  const image = `linear-gradient(90deg, ${railLeft}, ${railRight}), linear-gradient(90deg, ${edgeLeft}, ${edgeRight})`;
  const size = `100% ${railBand}px, 100% calc(100% - ${railBand}px)`;
  const position = `0 0, 0 ${railBand}px`;
  return {
    WebkitMaskImage: image,
    WebkitMaskPosition: position,
    WebkitMaskRepeat: "no-repeat, no-repeat",
    WebkitMaskSize: size,
    maskImage: image,
    maskPosition: position,
    maskRepeat: "no-repeat, no-repeat",
    maskSize: size,
  };
}

export function scrollbarThumb(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): { left: number; width: number } | undefined {
  if (clientWidth <= 0 || scrollWidth <= clientWidth) return undefined;
  const width = Math.max(THUMB_MIN, (clientWidth * clientWidth) / scrollWidth);
  const range = scrollWidth - clientWidth;
  const left = ((clientWidth - width) * Math.min(Math.max(scrollLeft, 0), range)) / range;
  return { left: Math.round(left), width: Math.round(width) };
}

export interface CameraFlight {
  index: number;
  
  target: number;
  from: number;
}

export function flightAfterScroll(
  flight: CameraFlight | undefined,
  scrollLeft: number,
): CameraFlight | undefined {
  if (flight === undefined) return undefined;
  const distance = Math.abs(scrollLeft - flight.target);
  if (distance <= 1) return undefined;
  if (distance > Math.abs(flight.from - flight.target) + 1) return undefined;
  return scrollLeft === flight.from ? flight : { ...flight, from: scrollLeft };
}

export function stationCameraLeft(index: number, clientWidth: number, inset = 0): number {
  return Math.max(0, stationX(index, inset) - (clientWidth - STATION_WIDTH) / 2);
}

export function railKey(from: number, to: number): string {
  return `${from}>${to}`;
}
