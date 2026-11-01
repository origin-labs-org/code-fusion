// ============================================================
// ============================================================

import { useId, useMemo, type CSSProperties } from "react";
import { Repeat2Icon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { STATUS_DOT } from "@/components/workflow-graph/run-status-presentation.js";
import type { StepRunStatus } from "@/components/workflow-graph/types.js";
import type {
  TimelineInk,
  TimelinePill,
  TimelineStation,
} from "@/components/workflow-timeline/timeline-model.js";
import { workflowActorModelLabels } from "@/components/workflow-timeline/subagent-model-label.js";
import { LaneGlyph, agentColor } from "@/components/workflow-timeline/WorkflowAgentPill.js";
import { MarchLight } from "@/components/workflow-timeline/WorkflowMarchLight.js";
import { StreamChevronsBox } from "@/components/workflow-timeline/WorkflowStreamChevrons.js";
import {
  SPINE_JOINT_PX,
  SPINE_TRACK_X,
  type SpineJoint,
  type SpineSection,
} from "@/app-shell/workflowRunSpine.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";

const SPINE_STUB_PX = 4;

const SPINE_STREAM_GAP_PX = 7;

const CLUSTER_MAX = 3;

export function SpineRail({
  ink,
  overhang,
  pitch,
  position,
  stream,
  track = 0,
}: {
  ink: TimelineInk;
  position: "above" | "below" | "full";
  
  stream?: true;
  track?: number;
  
  pitch: number;
  
  overhang?: "top" | "bottom";
}) {
  const x = SPINE_TRACK_X + pitch * track;
  const style: CSSProperties = {};
  const lit = ink === "march" && stream !== true;
  if (track > 0) style.left = lit ? x - 0.75 : x - 0.5;
  if (stream === true && position === "below") style.bottom = SPINE_STREAM_GAP_PX;
  if (stream === true && position === "above") {
    style.top = SPINE_STREAM_GAP_PX;
    style.height = 12 - SPINE_STREAM_GAP_PX;
  }
  if (overhang !== undefined) {
    style.top = overhang === "top" ? -SPINE_STUB_PX : 0;
    style.bottom = overhang === "bottom" ? -SPINE_STUB_PX : 0;
  }
  return (
    <span
      aria-hidden
      className={cn(
        "wf-ink absolute rounded-full",
        lit ? "left-[20.25px] w-[1.5px]" : "left-[20.5px] w-px",
        position === "above" ? "top-0 h-3" : position === "below" ? "bottom-0 top-6" : "inset-y-0",
        !lit && "bg-foreground-subtlest",
        lit && "wf-spine-march",
      )}
      data-rail-ink={ink}
      data-rail-kind={stream === true ? "stream" : undefined}
      data-rail-position={position}
      data-rail-track={track}
      data-testid="workflow-run-spine-rail"
      style={Object.keys(style).length === 0 ? undefined : style}
    />
  );
}

export function SpinePieces({ pitch, section }: { pitch: number; section: SpineSection }) {
  return (
    <>
      {section.rails.map((rail) => (
        <SpineRail key={`${rail.track}:${rail.position}`} pitch={pitch} {...rail} />
      ))}
      {section.rails.map((rail) =>
        rail.stream === true && rail.position === "below" ? (
          <StreamChevronsBox
            count={2}
            direction="down"
            ink={rail.ink}
            key={`stream:${rail.track}`}
            style={{ left: SPINE_TRACK_X + pitch * rail.track, top: "100%", zIndex: 1 }}
          />
        ) : null,
      )}
    </>
  );
}

export function SpineJointRow({
  joint,
  kind,
  pitch,
}: {
  joint: SpineJoint | undefined;
  kind: "fork" | "merge";
  pitch: number;
}) {
  const lightBase = useId();
  if (joint === undefined) return null;
  const main = SPINE_TRACK_X - 0.5;
  const r = Math.min(6, pitch / 2);
  const bus = SPINE_JOINT_PX / 2;
  const curves = joint.branches.map((branch) => {
    const x = main + pitch * branch.track;
    const d =
      kind === "fork"
        ? `M${main},0 V${bus - r} Q${main},${bus} ${main + r},${bus} H${x - r} Q${x},${bus} ${x},${bus + r} V${SPINE_JOINT_PX}`
        : `M${x},0 V${bus - r} Q${x},${bus} ${x - r},${bus} H${main + r} Q${main},${bus} ${main},${bus + r} V${SPINE_JOINT_PX}`;
    const from = kind === "fork" ? { x: main, y: 0 } : { x, y: 0 };
    const to = kind === "fork" ? { x, y: SPINE_JOINT_PX } : { x: main, y: SPINE_JOINT_PX };
    return { ...branch, d, from, to };
  });
  const width = main + pitch * Math.max(1, ...joint.branches.map((branch) => branch.track)) + 8;
  return (
    <div
      aria-hidden
      className="relative shrink-0"
      data-joint-kind={kind}
      data-joint-open={joint.open === true ? "true" : undefined}
      data-testid="workflow-run-spine-joint"
      style={{ height: SPINE_JOINT_PX }}
    >
      <SpineRail
        ink={joint.main}
        pitch={pitch}
        position="full"
        {...(joint.open === true ? { overhang: kind === "fork" ? "top" : "bottom" } : {})}
      />
      <svg
        className="absolute left-0 top-0 overflow-visible"
        height={SPINE_JOINT_PX}
        viewBox={`0 0 ${width} ${SPINE_JOINT_PX}`}
        width={width}
      >
        {curves.map((curve) => (
          <g
            data-curve-ink={curve.ink}
            data-curve-track={curve.track}
            data-testid={`workflow-run-spine-${kind}`}
            key={curve.track}
          >
            <path
              className="wf-ink"
              d={curve.d}
              fill="none"
              stroke="var(--color-foreground-subtlest)"
              strokeLinecap="round"
              strokeWidth={1}
            />
          </g>
        ))}
        {}
        {curves.map((curve) =>
          curve.ink === "march" ? (
            <g data-testid={`workflow-run-spine-${kind}-lit`} key={`lit:${curve.track}`}>
              <MarchLight
                d={curve.d}
                from={curve.from}
                id={`${lightBase}lit-${curve.track}`}
                to={curve.to}
              />
            </g>
          ) : null,
        )}
      </svg>
    </div>
  );
}

export function SpineLamp({
  pitch,
  status,
  track = 0,
}: {
  status: StepRunStatus;
  track?: number;
  pitch: number;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "wf-lamp absolute left-4 top-[13px] size-2.5 rounded-full",
        STATUS_DOT[status],
        status === "pending" && "bg-background",
        status === "running" && "wf-lamp-running motion-reduce:animate-none",
      )}
      data-lamp={status}
      data-testid="workflow-run-phase-lamp"
      style={track === 0 ? undefined : { left: 16 + pitch * track }}
    />
  );
}

export function AvatarCluster({
  pills,
  nameOf,
}: {
  pills: readonly TimelinePill[];
  nameOf: (pill: TimelinePill) => string;
}) {
  if (pills.length === 0) return null;
  const shown = pills.slice(0, CLUSTER_MAX);
  const more = pills.length - shown.length;
  return (
    <span className="flex items-center gap-1" data-testid="workflow-run-phase-cluster">
      {shown.map((pill) => {
        const tinted = pill.laneClass === "agent";
        const color = tinted ? agentColor(pill.avatarIndex, nameOf(pill)) : undefined;
        return (
          <span
            className={cn(
              "contents",
              tinted ? "text-[var(--wf-avatar)]" : "text-foreground-subtle",
            )}
            key={pill.key}
            style={color === undefined ? undefined : { ["--wf-avatar" as string]: color }}
            title={nameOf(pill)}
          >
            <LaneGlyph
              className="size-4 shrink-0"
              avatarIndex={pill.avatarIndex}
              laneClass={pill.laneClass}
              name={nameOf(pill)}
              status={pill.status}
            />
          </span>
        );
      })}
      {more > 0 ? (
        <span className="ml-1 font-mono text-ui-xs tabular-nums text-foreground-subtlest">
          +{more}
        </span>
      ) : null}
    </span>
  );
}

export function Rounds({ station }: { station: TimelineStation }) {
  const { intl } = useCfIntl();
  if (!station.onLoop || station.rounds === 0) return null;
  return (
    <span
      className="flex items-center gap-[3px]"
      data-testid="workflow-run-phase-rounds"
      title={intl.formatMessage(
        { id: "chat.toolCall.workflow.timeline.rounds" },
        { count: station.rounds },
      )}
    >
      <Repeat2Icon aria-hidden className="size-[11px]" />
      <span>{station.rounds}</span>
    </span>
  );
}

export function SpinePillTrailer({
  counts,
  modelName,
}: {
  counts: readonly string[];
  modelName: string | undefined;
}) {
  return (
    <>
      {counts.length === 0 ? null : (
        <span className="shrink-0 font-mono text-ui-xs tabular-nums text-foreground-subtlest">
          {counts.join(" · ")}
        </span>
      )}
      {modelName === undefined ? null : (
        <span
          className="min-w-0 max-w-[45%] truncate font-mono text-ui-xs text-foreground-subtlest"
          data-testid="workflow-run-agent-model"
        >
          {counts.length === 0 ? modelName : `· ${modelName}`}
        </span>
      )}
    </>
  );
}

export function useWorkflowActorModelLabels(
  actors: readonly { siteId: string; ordinal: number; model?: string }[] | undefined,
  providerName: ((providerId: string) => string | undefined) | undefined,
): ReadonlyMap<string, { name: string; canonical: string }> {
  const { intl } = useCfIntl();
  return useMemo(
    () =>
      workflowActorModelLabels(actors, {
        formatMessage: intl.formatMessage.bind(intl),
        ...(providerName === undefined ? {} : { providerName }),
      }),
    [actors, intl, providerName],
  );
}
