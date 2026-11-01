import { laneClassOf, MAIN_LANE_ID, type LaneClass, type WorkflowLaneData } from "./types.js";
import { formatNamePattern, type NamePattern } from "./name-pattern.js";

export interface LaneNaming {
  laneClass: LaneClass;
  
  name?: string;
  
  namePattern?: NamePattern;
  
  anonymousIndex?: number;
}

export type LaneNameFormatter = (
  descriptor: { id: string },
  values?: Record<string, string | number>,
) => string;

const NAME_ID_BY_CLASS: Partial<Record<LaneClass, string>> = {
  unresolved: "chat.toolCall.workflow.graph.lane.unresolved",
  workspace: "chat.toolCall.workflow.graph.lane.script",
};

export function laneDisplayName(lane: LaneNaming, formatMessage: LaneNameFormatter): string {
  const classNameId = NAME_ID_BY_CLASS[lane.laneClass];
  if (classNameId !== undefined) return formatMessage({ id: classNameId });
  if (lane.name !== undefined) return lane.name;
  const patterned = formatNamePattern(lane.namePattern);
  if (patterned !== undefined) return patterned;
  return lane.anonymousIndex === undefined
    ? formatMessage({ id: "chat.toolCall.workflow.graph.lane.anonymous" })
    : formatMessage(
        { id: "chat.toolCall.workflow.graph.lane.anonymousIndexed" },
        { index: lane.anonymousIndex },
      );
}

export interface LaneRef extends LaneNaming {
  id: string;
}

function anonymousLaneIndexes(lanes: readonly WorkflowLaneData[]): Map<string, number> {
  const anonymous = lanes.filter(
    (lane) =>
      lane.name === undefined &&
      formatNamePattern(lane.namePattern) === undefined &&
      laneClassOf(lane.id) === "agent" &&
      lane.id !== MAIN_LANE_ID,
  );
  if (anonymous.length < 2) return new Map();
  return new Map(anonymous.map((lane, index) => [lane.id, index + 1]));
}

export function laneRefsById(lanes: readonly WorkflowLaneData[]): Map<string, LaneRef> {
  const anonymousIndexes = anonymousLaneIndexes(lanes);
  return new Map(
    lanes.map((lane) => {
      const anonymousIndex = anonymousIndexes.get(lane.id);
      return [
        lane.id,
        {
          id: lane.id,
          laneClass: laneClassOf(lane.id),
          ...(lane.name === undefined ? {} : { name: lane.name }),
          ...(lane.namePattern === undefined ? {} : { namePattern: lane.namePattern }),
          ...(anonymousIndex === undefined ? {} : { anonymousIndex }),
        },
      ];
    }),
  );
}
