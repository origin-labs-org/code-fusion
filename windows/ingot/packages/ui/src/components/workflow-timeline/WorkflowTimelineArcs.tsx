import type { ReactNode } from "react";
import type { TimelineArc, TimelineBand, TimelineInk, TimelineStation } from "./timeline-model.js";
import {
  ARC_BASE,
  ARC_LANE,
  arcEnds,
  arcTerminalOffsets,
  bandAt,
  bandForkX,
  bandMergeX,
  lampX,
  type TimelineLayout,
} from "./timeline-geometry.js";
import { MarchLight } from "./WorkflowMarchLight.js";
import { STREAM_GAP, StreamChevrons } from "./WorkflowStreamChevrons.js";

const INK_STROKE: Record<TimelineInk, string> = {
  faint: "var(--color-workflow-trace)",
  march: "var(--color-workflow-trace-strong)",
  strong: "var(--color-workflow-trace-strong)",
};

export function WorkflowTimelineArcs({
  arcs,
  bands,
  children,
  height,
  layout,
  markerId,
  stations,
  width,
}: {
  arcs: readonly TimelineArc[];
  bands: readonly TimelineBand[];
  
  stations: readonly TimelineStation[];
  layout: TimelineLayout;
  width: number;
  height: number;
  markerId: string;
  children?: ReactNode;
}) {
  const terminals = arcTerminalOffsets(arcs, bands, stations);
  const { inset, rowY } = layout;
  const rowOf = (track: number): number => rowY[track] ?? rowY[0]!;
  const trackOf = (index: number): number => stations[index]?.track ?? 0;
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      <defs>
        {(["faint", "strong"] as const).map((ink) => (
          <marker
            id={`${markerId}-${ink}`}
            key={ink}
            markerHeight="6"
            markerWidth="6"
            orient="auto-start-reverse"
            refX="7"
            refY="4"
            viewBox="0 0 8 8"
          >
            <path d="M0,0.5 L7,4 L0,7.5 Z" fill={INK_STROKE[ink]} />
          </marker>
        ))}
      </defs>
      {children}
      {arcs.map((arc, j) => {
        const { fromBand, toBand } = arcEnds(arc, bands, stations);
        const source = bandAt(bands, arc.from);
        const target = bandAt(bands, arc.to);
        const ly = rowOf(arc.air) - ARC_BASE - ARC_LANE * arc.lane;
        const xa =
          fromBand && source !== undefined
            ? bandMergeX(source, inset)
            : lampX(arc.from, inset) + terminals.takeoff[j]!;
        const xb =
          toBand && target !== undefined
            ? bandForkX(target, inset)
            : lampX(arc.to, inset) + terminals.landing[j]!;
        const sign = xb < xa ? -1 : 1;
        const ya = fromBand ? rowY[0]! - 3 : rowOf(trackOf(arc.from)) - 7;
        const yb = toBand ? rowY[0]! - 4 : rowOf(trackOf(arc.to)) - 9;
        const tail = `V${yb}`;
        const mid = (xa + xb) / 2;
        const across = arc.stream
          ? `H${mid - (STREAM_GAP / 2) * sign} M${mid + (STREAM_GAP / 2) * sign},${ly} H${xb - 8 * sign}`
          : `H${xb - 8 * sign}`;
        const path = `M${xa},${ya} V${ly + 8} Q${xa},${ly} ${xa + 8 * sign},${ly} ${across} Q${xb},${ly} ${xb},${ly + 8} ${tail}`;
        const ink = arc.ink === "march" ? "strong" : arc.ink;
        return (
          <g
            data-arc-from={arc.from}
            data-arc-ink={arc.ink}
            data-arc-stream={arc.stream ? "true" : undefined}
            data-arc-to={arc.to}
            data-testid="workflow-timeline-arc"
            key={`${arc.from}-${arc.to}-${arc.air}`}
          >
            <path
              className="wf-ink wf-draw"
              d={path}
              fill="none"
              markerEnd={`url(#${markerId}-${ink})`}
              pathLength={1}
              stroke={INK_STROKE[ink]}
              strokeWidth={1}
            />
            {arc.stream ? (
              <StreamChevrons
                direction={sign < 0 ? "left" : "right"}
                ink={arc.ink}
                x={mid}
                y={ly}
              />
            ) : null}
            {arc.ink === "march" && !arc.stream ? (
              <MarchLight
                d={`${path.slice(0, -tail.length)}V${yb - 6}`}
                from={{ x: xa, y: ya }}
                id={`${markerId}-lit-${j}`}
                to={{ x: xb, y: yb - 6 }}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
