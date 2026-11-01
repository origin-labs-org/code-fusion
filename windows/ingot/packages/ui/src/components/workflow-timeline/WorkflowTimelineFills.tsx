import { PenIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
} from "react";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { TimelineFill } from "./timeline-holes.js";
import { framePath, legendGaps, type TimelineFrame } from "./timeline-frames.js";
import { HEAD_ROW, MARK_X, stationX } from "./timeline-geometry.js";

export const FILL_FRESH_MS = 2_000;

export function useFreshFills(
  fills: readonly { holeId: string; filledAt?: number }[],
): ReadonlySet<string> {
  const compute = () => {
    const now = Date.now();
    return new Set(
      fills
        .filter((fill) => fill.filledAt !== undefined && now - fill.filledAt < FILL_FRESH_MS)
        .map((fill) => fill.holeId),
    );
  };
  const [fresh, setFresh] = useState<ReadonlySet<string>>(compute);
  const key = fills.map((fill) => `${fill.holeId}@${fill.filledAt ?? ""}`).join("\u0000");
  useEffect(() => {
    const next = compute();
    setFresh(next);
    if (next.size === 0) return undefined;
    const now = Date.now();
    const latest = Math.max(
      ...fills.filter((fill) => next.has(fill.holeId)).map((fill) => fill.filledAt ?? now),
    );
    const timer = setTimeout(() => setFresh(new Set()), Math.max(0, latest + FILL_FRESH_MS - now));
    return () => clearTimeout(timer);
  }, [key]);
  return fresh;
}

function fillHeadOf(target: EventTarget, inside: boolean): string | undefined {
  if (!(target instanceof Element)) return undefined;
  const owner =
    target.closest<HTMLElement>("[data-fill-head]") ??
    (inside ? target.querySelector<HTMLElement>("[data-fill-head]") : null);
  return owner?.dataset.fillHead;
}

function focusVisible(target: EventTarget): boolean {
  if (!(target instanceof Element)) return false;
  try {
    return target.matches(":focus-visible");
  } catch {
    return false;
  }
}

export function useFillHeadTarget(enabled: boolean): {
  active: string | undefined;
  handlers: {
    onPointerOver?: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerLeave?: () => void;
    onFocus?: (event: FocusEvent<HTMLDivElement>) => void;
    onBlur?: () => void;
  };
} {
  const [hovered, setHovered] = useState<string | undefined>(undefined);
  const [focused, setFocused] = useState<string | undefined>(undefined);
  const onPointerOver = useCallback((event: PointerEvent<HTMLDivElement>) => {
    setHovered(fillHeadOf(event.target, false));
  }, []);
  const onPointerLeave = useCallback(() => setHovered(undefined), []);
  const onFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    setFocused(focusVisible(event.target) ? fillHeadOf(event.target, true) : undefined);
  }, []);
  const onBlur = useCallback(() => setFocused(undefined), []);
  return enabled
    ? { active: hovered ?? focused, handlers: { onBlur, onFocus, onPointerLeave, onPointerOver } }
    : { active: undefined, handlers: {} };
}

function useRowWidths(key: string): {
  refFor: (from: number) => (element: HTMLElement | null) => void;
  widths: Readonly<Record<number, number>>;
} {
  const rows = useRef(new Map<number, HTMLElement>());
  const [widths, setWidths] = useState<Readonly<Record<number, number>>>({});
  const measure = useCallback(() => {
    const next: Record<number, number> = {};
    for (const [from, element] of rows.current) next[from] = element.offsetWidth;
    setWidths((previous) => {
      const same =
        Object.keys(previous).length === Object.keys(next).length &&
        Object.entries(next).every(([from, width]) => previous[Number(from)] === width);
      return same ? previous : next;
    });
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    for (const element of rows.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [key, measure]);
  const refFor = useCallback(
    (from: number) => (element: HTMLElement | null) => {
      if (element === null) rows.current.delete(from);
      else rows.current.set(from, element);
    },
    [],
  );
  return { refFor, widths };
}

export function WorkflowTimelineFills({
  active,
  fills,
  frames,
  fresh,
  height,
  inset,
  onOpenFill,
  width,
}: {
  fills: readonly TimelineFill[];
  
  frames: readonly TimelineFrame[];
  
  active: string | undefined;
  fresh: ReadonlySet<string>;
  height: number;
  width: number;
  inset: number;
  onOpenFill?: (fill: TimelineFill) => void;
}) {
  const { intl } = useCfIntl();
  const maskId = `wf-fill-legend-${useId().replace(/:/gu, "")}`;
  const headRows = new Map<number, TimelineFill[]>();
  for (const fill of fills) {
    const row = headRows.get(fill.from);
    if (row === undefined) headRows.set(fill.from, [fill]);
    else row.push(fill);
  }
  const rowLeft = (from: number): number => stationX(from, inset) + MARK_X - 6;
  const { refFor, widths } = useRowWidths([...headRows.keys()].join(","));
  if (frames.length === 0 && fills.length === 0) return null;
  const gaps = legendGaps(
    [...headRows.keys()].map((from) => ({ left: rowLeft(from), width: widths[from] ?? 0 })),
  );

  const renderHead = (fill: TimelineFill) => {
    const isFresh = fresh.has(fill.holeId);
    const on = active === fill.holeId;
    const time =
      fill.filledAt === undefined ? undefined : new Date(fill.filledAt).toLocaleTimeString();
    const title = intl.formatMessage(
      {
        id:
          time === undefined
            ? "chat.toolCall.workflow.hole.head.title.untimed"
            : "chat.toolCall.workflow.hole.head.title",
      },
      { name: fill.name, time: time ?? "" },
    );
    const body = (
      <>
        <PenIcon aria-hidden className="size-3 shrink-0" />
        <span className="min-w-0 max-w-[300px] truncate text-ui-caption font-medium">
          {fill.name}
        </span>
      </>
    );
    const className = cn(
      "wf-fill-head flex h-full items-center gap-1.5 whitespace-nowrap rounded-md",
      isFresh ? "wf-land text-warning" : on ? "text-foreground" : "text-foreground-subtle",
      onOpenFill !== undefined &&
        "cursor-pointer outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
    );
    const shared = {
      className,
      "data-fill-head": fill.holeId,
      "data-fill-on": on ? "true" : undefined,
      "data-testid": "workflow-timeline-fill-head",
      title,
    };
    return onOpenFill === undefined ? (
      <span key={fill.holeId} {...shared}>
        {body}
      </span>
    ) : (
      <button key={fill.holeId} onClick={() => onOpenFill(fill)} type="button" {...shared}>
        {body}
      </button>
    );
  };
  return (
    <>
      {}
      <svg
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        data-testid="workflow-timeline-fill-frames"
        height={height}
        width={width}
      >
        {gaps.length === 0 ? null : (
          <defs>
            <mask
              height={height + 40}
              id={maskId}
              maskUnits="userSpaceOnUse"
              width={width + 40}
              x={-20}
              y={-20}
            >
              <rect fill="white" height={height + 40} width={width + 40} x={-20} y={-20} />
              {gaps.map((gap) => (
                <rect
                  fill="black"
                  height={HEAD_ROW}
                  key={gap.x}
                  width={gap.width}
                  x={gap.x}
                  y={0}
                />
              ))}
            </mask>
          </defs>
        )}
        {frames.map((frame) => {
          const isFresh = fresh.has(frame.holeId);
          return (
            <path
              className={cn("wf-fill-frame", isFresh && "wf-fill-frame-fresh")}
              d={framePath(frame.box)}
              data-fill-frame={frame.holeId}
              data-fill-fresh={isFresh ? "true" : undefined}
              data-fill-on={isFresh || active === frame.holeId ? "true" : undefined}
              data-testid="workflow-timeline-fill-frame"
              key={frame.holeId}
              {...(gaps.length === 0 ? {} : { mask: `url(#${maskId})` })}
              pathLength={1}
            />
          );
        })}
      </svg>
      {[...headRows].map(([from, row]) => (
        <span
          className="absolute flex items-center gap-3"
          data-testid="workflow-timeline-fill-heads"
          key={from}
          ref={refFor(from)}
          style={{ height: HEAD_ROW, left: rowLeft(from), top: 0 }}
        >
          {row.map(renderHead)}
        </span>
      ))}
    </>
  );
}
