// ============================================================
// ============================================================

import type {
  ExecutionPort,
  FileSystemPort,
  Logger,
  ModelRequestAdmission,
  SessionId,
  SubmitVerdict as ContractsSubmitVerdict,
  ToolArtifactStorePort,
  WorkflowEscalatePort,
  WorkflowSubmitPort,
} from "@origin-ai/cf-contracts";
import type { AgentRuntime } from "@origin-ai/cf-core";
import type {
  ActorSubmitProfile,
  ActorRef,
  ActorSessionSeed,
  InstanceRef,
  JournalStorePort,
  PersonaSpec,
  RunEvent,
  SessionRef,
} from "@origin-ai/cf-dynamic-workflow";
import type { ActorTranscriptStore } from "./workflow-actor-transcript.js";
import type { WorkflowConcurrencyPort } from "./workflow-concurrency-governor.js";
import type { ActorModelActivity, WorkflowClock } from "./workflow-driver-concurrency.js";
import type { ActorSessionQuiescence } from "./workflow-driver-quiescence.js";
import type { WorkflowEscalationRegistry } from "./workflow-escalation-registry.js";
import type { WorkflowRunSeatGate } from "./workflow-seat-gate.js";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export type ActorRuntimeFactory = (input: {
  sessionId: SessionId;
  actor: ActorRef;
  persona: PersonaSpec;
  submitPort: WorkflowSubmitPort;
  
  submitProfile: ActorSubmitProfile;
  
  escalatePort: WorkflowEscalatePort;
  
  seed?: ActorSessionSeed;
  
  modelRequestAdmission?: ModelRequestAdmission;
}) => AgentRuntime | Promise<AgentRuntime>;

export interface AgentRuntimeWorkflowDriverDeps {
  journal: JournalStorePort;
  emit: (event: RunEvent) => void;
  
  fileSystemPort: FileSystemPort;
  
  executionPort: ExecutionPort;
  
  escalationRegistry: WorkflowEscalationRegistry;
  
  cwd: string;
  
  artifactStore?: ToolArtifactStorePort;
  
  parentSessionId?: SessionId;
  
  actorSubmitProfiles?: ReadonlyMap<string, ActorSubmitProfile>;
  runtimeFactory: ActorRuntimeFactory;
  
  concurrency?: WorkflowConcurrencyPort;
  
  seatGate?: WorkflowRunSeatGate;
  
  actorTranscriptStore?: ActorTranscriptStore;
  logger?: Logger;
  
  runId?: string;
  
  clock?: WorkflowClock & {
    stallAfterMs?: number;
    quiesceMs?: number;
    random?: () => number;
  };
  
  onQuiescenceProbe?: (probe: ActorSessionQuiescence) => void;
}

export interface SessionState {
  readonly ref: SessionRef;
  
  readonly sessionId: SessionId;
  readonly runtime: AgentRuntime;
  
  submitProfile: ActorSubmitProfile;
  
  currentInstance?: InstanceRef;
  
  currentTyped: boolean;
  
  pendingSubmit?: Deferred<ContractsSubmitVerdict>;
  
  readonly pendingEscalations: Map<string, Deferred<string>>;
  
  escalationsUsed: number;
  
  abortController?: AbortController;
  
  accepted: boolean;
  
  cancelled: boolean;
  
  turnGeneration: number;
  
  turn?: Promise<void>;
  
  modelActivity: ActorModelActivity;
  
  readonly actor: ActorRef;
  readonly actorName: string | undefined;
  
  transientAttempts: number;
  
  cancelRedrive?: () => void;
}
