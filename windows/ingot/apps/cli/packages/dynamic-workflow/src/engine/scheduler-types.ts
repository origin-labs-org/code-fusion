

import type { ImportedActorState } from "./imported-cache.js";
import type {
  ActorId,
  ActorRef,
  AskSpec,
  AskStats,
  Caps,
  InstanceRef,
  PersonaSpec,
  RunEvent,
  SessionRef,
  ValidateFn,
  WorkflowDriver,
  WorkflowError,
} from "./types.js";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface SchedulerHost {
  readonly runId: string;
  
  readonly caps: Caps;
  readonly driver: WorkflowDriver;
  readonly validate: ValidateFn;
  
  nextOrdinal(siteId: string): number;
  
  holdForReplay(instance: InstanceRef, release: () => void): void;
  
  record(event: RunEvent): void;
  isRunSettled(): boolean;
  
  runError(): WorkflowError;
  
  failRun(error: WorkflowError): void;
  
  importCacheClosed(): boolean;
  
  wasLiveBeforeResume(instance: InstanceRef): boolean;
  
  wasQueuedBeforeImportClose(instance: InstanceRef): boolean;
}

export interface AskNode {
  instance: InstanceRef;
  actor: Actor;
  actorSeq: number;
  instructions: string;
  hash: string;
  spec: AskSpec;
  deferred: Deferred<unknown>;
  repairsRemaining: number;
  nudgesRemaining: number;
  settled: boolean;
  dispatched: boolean;
  lastStats?: AskStats;
  
  instructionsHead?: string;
}

export interface Actor {
  ref: ActorRef;
  id: ActorId;
  persona: PersonaSpec;
  name?: string;
  
  recordedCount: number;
  
  nextAdmitSeq: number;
  
  pendingRecorded: Map<number, () => void>;
  
  pendingLive: Array<() => void>;
  
  liveQueue: AskNode[];
  
  current?: AskNode;
  
  sessionPromise?: Promise<SessionRef>;
  session?: SessionRef;
  
  imported?: ImportedActorState;
}
