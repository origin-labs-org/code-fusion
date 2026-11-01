import type { StepRunStatus } from "@/components/workflow-graph/types.js";
import type { TimelinePill, TimelineStation } from "./timeline-model.js";

export const ROSTER_THRESHOLD = 6;

export const ROSTER_PINS_CARD = 5;

export const ROSTER_PINS_PANE = 5;

export const ROSTER_DECK = 3;

export type RosterCounts = Record<StepRunStatus, number>;

export interface RosterUnlisted {
  actors: number;
  settled: number;
  failed: number;
}

const NO_UNLISTED: RosterUnlisted = { actors: 0, failed: 0, settled: 0 };

export interface StationRoster {
  
  pinned: TimelinePill[];
  
  rest: TimelinePill[];
  
  counts: RosterCounts;
  
  unlisted: RosterUnlisted;
  total: number;
}

export function pillStatusOf(pill: Pick<TimelinePill, "status">): StepRunStatus {
  return pill.status ?? "pending";
}

export function pillInstanceKey(pill: Pick<TimelinePill, "instance">): string | undefined {
  return pill.instance === undefined
    ? undefined
    : `${pill.instance.siteId}@${pill.instance.ordinal}`;
}

export function rosterCounts(pills: readonly TimelinePill[]): RosterCounts {
  const counts: RosterCounts = { done: 0, failed: 0, pending: 0, running: 0 };
  for (const pill of pills) counts[pillStatusOf(pill)] += 1;
  return counts;
}

function addUnlisted(counts: RosterCounts, unlisted: RosterUnlisted): RosterCounts {
  counts.done += unlisted.settled - unlisted.failed;
  counts.failed += unlisted.failed;
  counts.pending += Math.max(0, unlisted.actors - unlisted.settled);
  return counts;
}

export const ATTENTION_ORDER: readonly StepRunStatus[] = ["failed", "running", "pending", "done"];
const ATTENTION_RANK: Record<StepRunStatus, number> = {
  failed: 0,
  running: 1,
  pending: 2,
  done: 3,
};

function byAttention(pills: readonly TimelinePill[]): TimelinePill[] {
  return pills
    .map((pill, index) => ({ index, pill }))
    .sort(
      (left, right) =>
        ATTENTION_RANK[pillStatusOf(left.pill)] - ATTENTION_RANK[pillStatusOf(right.pill)] ||
        left.index - right.index,
    )
    .map((entry) => entry.pill);
}

export function stationRoster(
  pills: readonly TimelinePill[],
  options: { pins: number; unlisted?: RosterUnlisted },
): StationRoster | undefined {
  const unlisted = options.unlisted ?? NO_UNLISTED;
  const total = pills.length + unlisted.actors;
  if (total <= ROSTER_THRESHOLD) return undefined;
  const counts = addUnlisted(rosterCounts(pills), unlisted);

  const pinned: TimelinePill[] = [];
  const pin = (pill: TimelinePill) => {
    if (pinned.length < options.pins && !pinned.includes(pill)) pinned.push(pill);
  };
  for (const pill of pills) if (pill.asking === true) pin(pill);
  for (const pill of pills) if (pillStatusOf(pill) === "running") pin(pill);
  for (const pill of pills) if (pillStatusOf(pill) === "failed") pin(pill);
  for (const pill of pills) pin(pill);

  const rest = pills.filter((pill) => !pinned.includes(pill));
  return { counts, pinned, rest, total, unlisted };
}

export function stationRosterOf(
  station: Pick<TimelineStation, "pills" | "unlisted">,
  pins: number,
): StationRoster | undefined {
  return stationRoster(station.pills, {
    pins,
    ...(station.unlisted === undefined
      ? {}
      : {
          unlisted: {
            actors: station.unlisted.actors,
            failed: station.unlisted.failed,
            settled: station.unlisted.settled,
          },
        }),
  });
}

export function rosterRestCounts(roster: StationRoster): RosterCounts {
  return addUnlisted(rosterCounts(roster.rest), roster.unlisted);
}

export interface RosterMore {
  
  count: number;
  
  deck: TimelinePill[];
  
  failed: number;
}

export function rosterMore(roster: StationRoster, deck: number = ROSTER_DECK): RosterMore {
  const pinnedFailed = roster.pinned.filter((pill) => pillStatusOf(pill) === "failed").length;
  return {
    count: roster.rest.length + roster.unlisted.actors,
    deck: byAttention(roster.rest).slice(0, deck),
    failed: roster.counts.failed - pinnedFailed,
  };
}

export interface RollGroup {
  status: StepRunStatus;
  pills: TimelinePill[];
}

export function rosterRoll(roster: StationRoster): RollGroup[] {
  return ATTENTION_ORDER.map((status) => ({
    pills: roster.rest.filter((pill) => pillStatusOf(pill) === status),
    status,
  })).filter((group) => group.pills.length > 0);
}
