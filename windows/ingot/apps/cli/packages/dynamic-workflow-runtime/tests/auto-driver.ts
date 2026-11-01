

import type {
  ActorRef,
  ArtifactPublishRequest,
  ArtifactVersionRecord,
  AskMessage,
  AskStats,
  InstanceRef,
  JournalStorePort,
  PersonaSpec,
  RunEvent,
  SessionRef,
  SubmitVerdict,
  WorkflowDriver,
  WorkflowError,
  WorkflowReportSink,
  WorldReadOp,
} from "@origin-ai/cf-dynamic-workflow";
import { refToString } from "@origin-ai/cf-dynamic-workflow";

export type AskAction =
  
  | { type: "submit"; payload: unknown; stats?: AskStats; delayMs?: number }
  | { type: "text"; finalText: string; stats?: AskStats }
  | { type: "fail"; error: WorkflowError }
  
  | { type: "stop-run"; error: WorkflowError };

export type AskResponder = (ctx: { instance: InstanceRef; message: AskMessage }) => AskAction | AskAction[];

export interface AutoDriverConfig {
  
  asks?: Record<string, AskResponder>;
  
  worldReads?: (op: WorldReadOp, args: unknown[]) => unknown | Promise<unknown>;
  
  artifacts?: (request: ArtifactPublishRequest) => ArtifactVersionRecord | Promise<ArtifactVersionRecord>;
  
  onStartAsk?: (instance: InstanceRef, message: AskMessage) => void;
}

interface StartAskCall {
  session: SessionRef;
  instance: InstanceRef;
  message: AskMessage;
}

export class AutoDriver implements WorkflowDriver {
  readonly events: RunEvent[] = [];
  readonly startAsks: StartAskCall[] = [];
  readonly sessionCreations: ActorRef[] = [];
  readonly cancels: InstanceRef[] = [];
  
  readonly artifactPublishes: ArtifactPublishRequest[] = [];

  private sink: WorkflowReportSink | undefined;
  private readonly scripts = new Map<string, { actions: AskAction[]; idx: number }>();

  constructor(
    readonly journal: JournalStorePort,
    private readonly config: AutoDriverConfig = {},
  ) {}

  
  attach(sink: WorkflowReportSink): void {
    this.sink = sink;
  }

  createActorSession(actor: ActorRef, _persona: PersonaSpec): Promise<SessionRef> {
    this.sessionCreations.push(actor);
    return Promise.resolve({ id: `session:${refToString(actor)}` });
  }

  startAsk(session: SessionRef, instance: InstanceRef, message: AskMessage): void {
    this.startAsks.push({ session, instance, message });
    this.config.onStartAsk?.(instance, message);
    const responder = this.config.asks?.[instance.siteId];
    const raw = responder ? responder({ instance, message }) : defaultAction(message);
    const actions = Array.isArray(raw) ? raw : [raw];
    this.scripts.set(refToString(instance), { actions, idx: 0 });
    this.perform(instance);
  }

  respondToSubmit(instance: InstanceRef, verdict: SubmitVerdict): void {
    if (verdict.kind === "accept") return;
    const script = this.scripts.get(refToString(instance));
    if (script === undefined) return;
    script.idx++;
    this.perform(instance);
  }

  cancelAsk(instance: InstanceRef): void {
    this.cancels.push(instance);
  }

  executeWorldRead(op: WorldReadOp, args: unknown[]): Promise<unknown> {
    const handler = this.config.worldReads ?? defaultWorldRead;
    return Promise.resolve(handler(op, args));
  }

  async executeArtifactPublish(request: ArtifactPublishRequest): Promise<ArtifactVersionRecord> {
    this.artifactPublishes.push(request);
    const handler = this.config.artifacts ?? defaultArtifactPublish;
    return handler(request);
  }

  emit(event: RunEvent): void {
    this.events.push(event);
  }

  private perform(instance: InstanceRef): void {
    const script = this.scripts.get(refToString(instance));
    if (script === undefined) return;
    const action = script.actions[script.idx];
    if (action === undefined) return;
    const delayMs = action.type === "submit" ? action.delayMs : undefined;
    const schedule = (fn: () => void): void => {
      if (delayMs === undefined) queueMicrotask(fn);
      else setTimeout(fn, delayMs);
    };
    schedule(() => {
      const sink = this.sink;
      if (sink === undefined) throw new Error("AutoDriver: sink 未 attach");
      if (action.type !== "fail" && action.type !== "stop-run" && action.stats !== undefined)
        sink.askStats(instance, action.stats);
      switch (action.type) {
        case "submit":
          sink.askSubmitAttempted(instance, action.payload);
          return;
        case "text":
          sink.askTurnEnded(instance, action.finalText);
          return;
        case "fail":
          sink.askFailed(instance, action.error);
          return;
        case "stop-run":
          sink.stopRun(action.error);
          return;
      }
    });
  }

  startAskCount(): number {
    return this.startAsks.length;
  }

  eventsOfType<T extends RunEvent["type"]>(type: T): Array<Extract<RunEvent, { type: T }>> {
    return this.events.filter((e) => e.type === type) as Array<Extract<RunEvent, { type: T }>>;
  }
}

function defaultAction(message: AskMessage): AskAction {
  return message.typed ? { type: "submit", payload: {} } : { type: "text", finalText: "ok" };
}

function defaultArtifactPublish(request: ArtifactPublishRequest): ArtifactVersionRecord {
  return {
    id: request.id,
    kind: request.op,
    version: request.version,
    contentType: request.op === "markdown" ? "text/markdown" : "application/octet-stream",
    bytes: (request.content ?? request.path ?? "").length,
    uri: `cf-artifact://auto/${request.id}/${request.version}`,
    ...(request.path === undefined ? {} : { sourcePath: request.path }),
    publishedAt: 1,
  };
}

function defaultWorldRead(op: WorldReadOp): unknown {
  return op === "glob" ? [] : "";
}
