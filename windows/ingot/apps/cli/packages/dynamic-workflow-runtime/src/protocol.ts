

import type { ArtifactContentOp, ArtifactPresetOp, WorldReadOp } from "@origin-ai/cf-dynamic-workflow";

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

export interface WireError {
  name: string;
  message: string;
  code?: string;
  violations?: unknown[];
  finalText?: string;
  stack?: string;
}

// ————————————————————————————————————————————————————————————————
// child → parent
// ————————————————————————————————————————————————————————————————

export interface CreateActorMessage {
  kind: "create-actor";
  localId: string;
  siteId: string;
  name?: string;
  persona?: unknown;
}

export interface RequestMessage {
  kind: "request";
  id: string;
  
  type: "ask" | "world-read" | "publish-artifact" | "hole";
  siteId: string;
  
  actor?: string;
  
  instructions?: string;
  
  name?: string;
  
  prompt?: string;
  
  op?: WorldReadOp;
  
  artifactOp?: ArtifactContentOp;
  
  args?: unknown[];
}

export type EventMessage =
  | LogEventMessage
  | ReportEventMessage
  | DeclareArtifactEventMessage
  | PhaseEnteredEventMessage;

export interface PhaseEnteredEventMessage {
  kind: "event";
  type: "phase-entered";
  
  name: string;
}

export interface LogEventMessage {
  kind: "event";
  type: "log";
  message: string;
}

export interface ReportEventMessage {
  kind: "event";
  type: "report";
  siteId: string;
  item: unknown;
  
  artifactId?: string;
}

export interface DeclareArtifactEventMessage {
  kind: "event";
  type: "declare-artifact";
  siteId: string;
  op: ArtifactPresetOp;
  
  args: unknown[];
}

export interface CompleteMessage {
  kind: "complete";
  ok: boolean;
  value?: unknown;
  error?: WireError;
}

export type ChildMessage = CreateActorMessage | RequestMessage | EventMessage | CompleteMessage;

// ————————————————————————————————————————————————————————————————
// parent → child
// ————————————————————————————————————————————————————————————————

export interface ResponseMessage {
  kind: "response";
  id: string;
  ok: boolean;
  value?: unknown;
  error?: WireError;
}

export type ParentMessage = ResponseMessage;

export interface ChildPayload {
  
  lowered: string;
  
  args?: Record<string, unknown>;
  
  maxOldSpaceSizeMb?: number;
}
