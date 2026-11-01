// ============================================================
// ============================================================
//

export type DynamicWorkflowRunPhaseState = "done" | "current" | "ahead" | "unfinished";

export interface DynamicWorkflowRunPhaseView {
  
  name: string;
  state: DynamicWorkflowRunPhaseState;
  
  rounds: number;
  
  nodesSettled: number;
  nodesRunning: number;
  
  enteredAt?: number;
  exitedAt?: number;
}

export type DynamicWorkflowRunSubagentState =
  | "idle"
  | "executing"
  | "waiting"
  | "parked"
  | "done"
  | "failed"
  | "unfinished";

export interface DynamicWorkflowRunSubagentLastTool {
  name: string;
  target?: string;
  
  at?: number;
}

export interface DynamicWorkflowRunSubagentAsk {
  siteId: string;
  ordinal: number;
  
  actorSeq?: number;
  
  instructionsHead?: string;
  
  startedAt?: number;
  
  turn?: number;
  toolCalls?: number;
  lastTool?: DynamicWorkflowRunSubagentLastTool;
}

export interface DynamicWorkflowRunSubagentWait {
  
  cause: "slot" | "backoff";
  reason?: string;
  retryAfterMs?: number;
  
  since?: number;
}

export interface DynamicWorkflowRunSubagentView {
  siteId: string;
  ordinal: number;
  
  name?: string;
  state: DynamicWorkflowRunSubagentState;
  
  phaseName?: string;
  currentAsk?: DynamicWorkflowRunSubagentAsk;
  wait?: DynamicWorkflowRunSubagentWait;
  
  parkedOn?: string;
  
  stepsSettled: number;
  stepsFailed: number;
  tokens: number;
  
  lastProgressAt?: number;
}

export interface DynamicWorkflowRunConcurrencyHealth {
  
  effective: number;
  
  cap: number;
  
  reason?: string;
  
  since?: number;
}

export interface DynamicWorkflowRunHealth {
  
  lastProgressAt?: number;
  
  stalledSince?: number;
  concurrency?: DynamicWorkflowRunConcurrencyHealth;
  
  consecutiveFailures: number;
  
  cachedSteps: number;
  
  leftoverRunning?: number;
  
  pendingQuestionsKnown: boolean;
}
