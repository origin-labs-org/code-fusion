

import type { NodeKind, RunEvent } from "./types.js";

export type RunEventType = RunEvent["type"];

const NODE_KIND_SET: Record<NodeKind, true> = {
  ask: true,
  "world-read": true,
  "world-run": true,
  report: true,
  artifact: true,
};

export const NODE_KINDS: readonly NodeKind[] = Object.keys(NODE_KIND_SET) as NodeKind[];

export const NON_REPORT_NODE_KINDS: readonly NodeKind[] = NODE_KINDS.filter(
  (kind) => kind !== "report",
);

export interface ListNodesOptions {
  
  kinds: readonly NodeKind[] | "all";
  
  withResult: boolean;
  
  limit?: number;
  
  maxResultBytes?: number;
}

export interface GetNodeOptions {
  
  withResult: boolean;
}

export interface ListActorsOptions {
  
  name?: string;
  
  withPersona: boolean;
}

export interface ListEventsOptions {
  
  types: readonly RunEventType[] | "all";
  
  reportItems: "all" | { limit: number };
  
  afterSequence?: number;
  
  limit?: number;
}

export const ALL_EVENTS: ListEventsOptions = { types: "all", reportItems: "all" };
