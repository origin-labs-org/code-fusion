import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@/components/lib/utils.js";
import { laneDisplayName } from "@/components/workflow-graph/lane-name.js";
import { phaseDisplayName } from "@/components/workflow-graph/phase-name.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { TimelinePill, TimelineStation, WorkflowTimelineModel } from "./timeline-model.js";
import { ROSTER_PINS_CARD, rosterMore, stationRosterOf } from "./roster-model.js";
import { useTypewriter } from "./use-typewriter.js";
import { WorkflowAgentPill } from "./WorkflowAgentPill.js";
import { WorkflowMoreRow } from "./WorkflowMoreRow.js";
import {
  PILL_GAP,
  PILL_HEIGHT,
  RAIL_ROW,
  STATION_PITCH,
  STATION_WIDTH,
  stationX,
  timelineLayout,
  timelineWidth,
} from "./timeline-geometry.js";
import { WorkflowTimelineArcs } from "./WorkflowTimelineArcs.js";
import {
  WorkflowTimelineFills,
  useFillHeadTarget,
  useFreshFills,
} from "./WorkflowTimelineFills.js";
import type { TimelineFill } from "./timeline-holes.js";
import { timelineFrames } from "./timeline-frames.js";
import { WorkflowStationPlatform, WorkflowStationRow } from "./WorkflowTimelineStation.js";
import { WorkflowTimelineLamps, WorkflowTimelineTracks } from "./WorkflowTimelineTracks.js";
import {
  NO_FOLD,
  flightAfterScroll,
  foldStations,
  ledgeStubWidth,
  railKey,
  stationCameraLeft,
  timelineMaskStyle,
  type CameraFlight,
} from "./timeline-ledge.js";
import { useTimelineViewport } from "./use-timeline-viewport.js";
import { slideClass, slideStyle, useFillGrowth } from "./use-fill-growth.js";
import {
  WorkflowLedge,
  WorkflowTimelineScrollbar,
  prefersReducedMotion,
} from "./WorkflowTimelineLedge.js";

export { STATION_GAP, STATION_PITCH, STATION_WIDTH, timelineWidth } from "./timeline-geometry.js";

function stationHeight(station: TimelineStation): number {
  const roster = stationRosterOf(station, ROSTER_PINS_CARD);
  const n = roster === undefined ? station.pills.length : roster.pinned.length + 1;
  return n === 0 ? 0 : n * PILL_HEIGHT + (n - 1) * PILL_GAP;
}

export function timelineHeight(model: WorkflowTimelineModel): number {
  const rows = timelineLayout(model.arcs, model.bands, hasFillHeads(model));
  return rows.pillsTop + Math.max(0, ...model.stations.map(stationHeight)) + 8;
}

function hasFillHeads(model: Pick<WorkflowTimelineModel, "fills">): boolean {
  return (model.fills?.length ?? 0) > 0;
}

export const PILL_STAGGER_MS = 30;

function pillName(pill: TimelinePill, format: Parameters<typeof laneDisplayName>[1]): string {
  return pill.runtimeName ?? laneDisplayName(pill.lane, format);
}

export interface WorkflowTimelineProps {
  model: WorkflowTimelineModel;
  className?: string;
  
  onSelectStation?: (station: TimelineStation) => void;
  
  onOpenMore?: (station: TimelineStation) => void;
  
  onOpenPill?: (pill: TimelinePill) => void;
  
  onOpenWorkspace?: (pill: TimelinePill) => void;
  
  onOpenFill?: (fill: TimelineFill) => void;
}

export const WorkflowTimeline = memo(function WorkflowTimeline({
  className,
  model,
  onOpenFill,
  onOpenMore,
  onOpenPill,
  onOpenWorkspace,
  onSelectStation,
}: WorkflowTimelineProps) {
  const { intl } = useCfIntl();
  const format = intl.formatMessage.bind(intl);
  const markerId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const attachScroller = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    setScroller(element);
  }, []);
  const [flight, setFlight] = useState<CameraFlight | undefined>(undefined);

  const { arcs } = model;
  const draft = model.draft !== undefined;
  const fullNames = model.stations.map((station) => phaseDisplayName(station.naming, format));
  const pen = useTypewriter(draft ? fullNames : undefined);
  const stations = draft ? model.stations.slice(0, pen.visible) : model.stations;
  const n = stations.length;
  const rails = draft ? model.rails.filter((rail) => rail.to < n) : model.rails;
  const fills = (model.fills ?? []).filter((fill) => fill.to < n);
  const layout = timelineLayout(model.arcs, model.bands, fills.length > 0);
  const { banded, inset, pillsTop } = layout;
  const top = layout.rowY[0]! - RAIL_ROW / 2;
  const width = timelineWidth(n, inset, model.tailStub !== undefined);
  const height = timelineHeight(draft ? { ...model, stations } : model);
  const frames = timelineFrames({
    columnHeight: (i) => stationHeight(stations[i]!),
    fills,
    height,
    inset,
    layout,
    parents: model.holeParents ?? {},
    stations,
    width,
  });
  const fillTarget = useFillHeadTarget(frames.length > 0);
  const fresh = useFreshFills(frames);
  const slide = useFillGrowth(model);
  let pillOrdinal = 0;
  const nextDelay = () => {
    const delay = PILL_STAGGER_MS * pillOrdinal;
    pillOrdinal += 1;
    return delay;
  };
  const railByPair = useMemo(
    () => new Map(rails.map((rail) => [railKey(rail.from, rail.to), rail])),
    [rails],
  );

  const viewport = useTimelineViewport(scroller, width);
  useEffect(() => {
    setFlight((current) => flightAfterScroll(current, viewport.scrollLeft));
  }, [viewport.scrollLeft]);
  const overflow = viewport.clientWidth > 0 && viewport.scrollWidth > viewport.clientWidth;
  const fold = overflow
    ? foldStations(n, viewport.scrollLeft, viewport.clientWidth, flight?.index, inset)
    : NO_FOLD;
  const folded = useMemo(() => new Set([...fold.left, ...fold.right]), [fold]);
  const mask = overflow
    ? timelineMaskStyle(fold, pillsTop - 8, {
        left: viewport.scrollLeft > 0,
        right: viewport.scrollLeft < viewport.scrollWidth - viewport.clientWidth - 1,
      })
    : undefined;

  const scrollTo = useCallback((left: number) => {
    const element = scrollRef.current;
    if (element === null) return;
    element.scrollTo({ behavior: prefersReducedMotion() ? "auto" : "smooth", left });
  }, []);
  const selectFolded = useCallback(
    (index: number) =>
      scrollTo(stationCameraLeft(index, scrollRef.current?.clientWidth ?? 0, inset)),
    [inset, scrollTo],
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-testid='workflow-timeline-station'], .wf-ledge") === null) return;
      const element = scrollRef.current;
      if (element === null || element.scrollWidth <= element.clientWidth) return;
      event.preventDefault();
      scrollTo(element.scrollLeft + (event.key === "ArrowLeft" ? -STATION_PITCH : STATION_PITCH));
    },
    [scrollTo],
  );

  const focusIndex = draft ? (n > 0 ? n - 1 : undefined) : model.runningIndex;
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null || focusIndex === undefined) return;
    if (element.scrollWidth <= element.clientWidth) return;
    const left = draft
      ? Math.max(0, stationX(focusIndex, inset) + STATION_WIDTH - element.clientWidth)
      : stationCameraLeft(focusIndex, element.clientWidth, inset);
    const target = Math.min(left, element.scrollWidth - element.clientWidth);
    const from = element.scrollLeft;
    setFlight(Math.abs(from - target) <= 1 ? undefined : { from, index: focusIndex, target });
    element.scrollTo({ behavior: prefersReducedMotion() ? "auto" : "smooth", left });
  }, [draft, focusIndex, inset]);

  if (n === 0) return null;

  const stationTitleOf = (phaseId: string): string => {
    const station = model.stations.find((candidate) => candidate.id === phaseId);
    return station === undefined ? phaseId : phaseDisplayName(station.naming, format);
  };
  const stationTitle = (station: TimelineStation): string => {
    const name = phaseDisplayName(station.naming, format);
    return station.onLoop && station.rounds > 0
      ? `${name} · ${intl.formatMessage({ id: "chat.toolCall.workflow.timeline.rounds" }, { count: station.rounds })}`
      : name;
  };

  const renderPill = (pill: TimelinePill) => {
    const enterDelayMs = nextDelay();
    const label = pillName(pill, format);
    const open =
      onOpenPill !== undefined && pill.slot !== undefined
        ? {
            label: format({ id: "chat.toolCall.workflow.timeline.openAgent" }, { name: label }),
            onOpen: () => onOpenPill(pill),
            testId: "workflow-timeline-pill-open",
          }
        : onOpenWorkspace !== undefined && pill.workspace !== undefined
          ? {
              label: format(
                { id: "chat.toolCall.workflow.timeline.openScript" },
                { phase: stationTitleOf(pill.workspace.phaseId) },
              ),
              onOpen: () => onOpenWorkspace(pill),
              testId: "workflow-timeline-workspace-open",
            }
          : undefined;
    return (
      <WorkflowAgentPill
        enterDelayMs={enterDelayMs}
        key={pill.key}
        avatarIndex={pill.avatarIndex}
        laneClass={pill.laneClass}
        name={label}
        status={pill.status}
        {...(open === undefined ? {} : { open })}
      />
    );
  };

  const ledgeProps = {
    nameOf: (index: number) => fullNames[index]!,
    onSelect: selectFolded,
    rails: railByPair,
    stations,
    top,
  };

  return (
    <div
      className={cn("wf-motion wf-timeline min-w-0", className)}
      data-testid="workflow-timeline"
      onKeyDown={onKeyDown}
      {...fillTarget.handlers}
    >
      {}
      <div className="relative">
        <div
          className="wf-scroller overflow-x-auto overflow-y-hidden"
          data-testid="workflow-timeline-scroller"
          data-timeline-fade={
            fold.left.length > 0 && fold.right.length > 0
              ? "both"
              : fold.left.length > 0
                ? "left"
                : fold.right.length > 0
                  ? "right"
                  : undefined
          }
          ref={attachScroller}
          style={mask}
        >
          <div className="relative" style={{ height, width }}>
            {}
            <WorkflowTimelineFills
              active={fillTarget.active}
              fills={fills}
              frames={frames}
              fresh={fresh}
              height={height}
              inset={inset}
              width={width}
              {...(onOpenFill === undefined ? {} : { onOpenFill })}
            />
            <WorkflowTimelineArcs
              arcs={arcs}
              bands={model.bands}
              height={height}
              layout={layout}
              markerId={markerId}
              stations={model.stations}
              width={width}
            >
              {}
              {banded ? (
                <WorkflowTimelineTracks
                  folded={folded}
                  layout={layout}
                  model={{ bands: model.bands, rails, stations }}
                />
              ) : null}
            </WorkflowTimelineArcs>

            {banded ? (
              <WorkflowTimelineLamps
                draft={draft}
                folded={folded}
                layout={layout}
                stations={stations}
                {...(slide === undefined ? {} : { slide })}
              />
            ) : null}

            {banded ? (
              <WorkflowStationPlatform
                folded={folded}
                fullNames={fullNames}
                layout={layout}
                stations={stations}
                titleOf={stationTitle}
                {...(slide === undefined ? {} : { slide })}
                {...(onSelectStation === undefined ? {} : { onSelectStation })}
              />
            ) : (
              <WorkflowStationRow
                draft={draft}
                folded={folded}
                fresh={fresh}
                fullNames={fullNames}
                pen={pen}
                rails={railByPair}
                stations={stations}
                titleOf={stationTitle}
                top={top}
                width={width}
                {...(slide === undefined ? {} : { slide })}
                {...(model.tailStub === undefined ? {} : { tailStub: model.tailStub })}
                {...(onSelectStation === undefined ? {} : { onSelectStation })}
              />
            )}

            {stations.map((station, i) => {
              const roster = stationRosterOf(station, ROSTER_PINS_CARD);
              if (station.pills.length === 0 && roster === undefined) return null;
              return (
                <div
                  className={cn(
                    "absolute flex flex-col",
                    station.ghost && "wf-ghost",
                    slideClass(i, slide),
                  )}
                  data-fill={station.fill}
                  data-station-roster={roster === undefined ? undefined : "true"}
                  data-testid="workflow-timeline-pills"
                  key={station.id}
                  style={{
                    ...slideStyle(i, slide),
                    gap: PILL_GAP,
                    left: stationX(i, inset),
                    top: pillsTop,
                    width: STATION_WIDTH,
                  }}
                >
                  {roster === undefined ? (
                    station.pills.map(renderPill)
                  ) : (
                    <>
                      {roster.pinned.map(renderPill)}
                      <WorkflowMoreRow
                        enterDelayMs={nextDelay()}
                        more={rosterMore(roster)}
                        {...(onOpenMore === undefined ? {} : { onOpen: () => onOpenMore(station) })}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {}
        <WorkflowLedge
          indexes={fold.left}
          side="left"
          stubWidth={ledgeStubWidth(fold, "left", viewport.scrollLeft, viewport.clientWidth, inset)}
          {...ledgeProps}
        />
        <WorkflowLedge
          indexes={fold.right}
          side="right"
          stubWidth={ledgeStubWidth(
            fold,
            "right",
            viewport.scrollLeft,
            viewport.clientWidth,
            inset,
          )}
          {...ledgeProps}
        />
        {overflow ? <WorkflowTimelineScrollbar scrollRef={scrollRef} viewport={viewport} /> : null}
      </div>
    </div>
  );
});
