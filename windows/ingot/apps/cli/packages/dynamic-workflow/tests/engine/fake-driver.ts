

import type {
  ActorSessionSeed,
  ArtifactPublishRequest,
  ArtifactVersionRecord,
  AskMessage,
  InstanceRef,
  JournalStorePort,
  PersonaSpec,
  RunEvent,
  SessionRef,
  SubmitVerdict,
  WorkflowDriver,
  ActorRef,
  WorldReadOp,
} from "../../src/engine/index.js";
import { refToString } from "../../src/engine/index.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export async function flush(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

interface StartAskCall {
  session: SessionRef;
  instance: InstanceRef;
  message: AskMessage;
}

interface WorldReadCall {
  op: WorldReadOp;
  
  args: unknown[];
  deferred: Deferred<unknown>;
}

export interface FakeDriverOptions {
  
  withoutArtifactStore?: boolean;
  
  deferArtifactPublishes?: boolean;
  
  deferSessions?: boolean;
  
  resolveModel?: (persona: PersonaSpec) => string;
  
  runId?: string;
}

function titleOf(opts: unknown): string | undefined {
  const title = (opts as { title?: unknown } | undefined)?.title;
  return typeof title === "string" ? title : undefined;
}

export class FakeDriver implements WorkflowDriver {
  readonly startAsks: StartAskCall[] = [];
  readonly submitResponses: Array<{ instance: InstanceRef; verdict: SubmitVerdict }> = [];
  readonly cancels: InstanceRef[] = [];
  readonly sessionCreations: ActorRef[] = [];
  
  readonly sessionPersonas: PersonaSpec[] = [];
  
  readonly sessionSeeds: Array<ActorSessionSeed | undefined> = [];
  readonly worldReads: WorldReadCall[] = [];
  
  readonly artifactPublishes: ArtifactPublishRequest[] = [];
  
  readonly artifactDeferrals: Array<Deferred<ArtifactVersionRecord>> = [];
  
  readonly artifactStore = new Map<string, ArtifactVersionRecord>();
  readonly events: RunEvent[] = [];
  readonly sessionDeferrals: Array<Deferred<SessionRef>> = [];
  
  disposeCalls = 0;
  
  eventsAtDispose: number | undefined;

  constructor(
    readonly journal: JournalStorePort,
    private readonly options: FakeDriverOptions = {},
  ) {
    if (options.withoutArtifactStore === true) this.executeArtifactPublish = undefined;
  }

  createActorSession(
    actor: ActorRef,
    persona: PersonaSpec,
    seed?: ActorSessionSeed,
  ): Promise<SessionRef> {
    this.sessionCreations.push(actor);
    this.sessionPersonas.push(persona);
    this.sessionSeeds.push(seed);
    if (this.options.resolveModel !== undefined) {
      const runId = this.options.runId ?? "run";
      const existing = this.journal.getActor(runId, actor.siteId, actor.ordinal);
      this.journal.putActor({
        ...(existing ?? { runId, siteId: actor.siteId, ordinal: actor.ordinal }),
        resolvedModel: this.options.resolveModel(persona),
      });
    }
    const session: SessionRef = { id: `session:${refToString(actor)}` };
    if (this.options.deferSessions === true) {
      const d = defer<SessionRef>();
      this.sessionDeferrals.push(d);
      return d.promise;
    }
    return Promise.resolve(session);
  }

  startAsk(session: SessionRef, instance: InstanceRef, message: AskMessage): void {
    this.startAsks.push({ session, instance, message });
  }

  respondToSubmit(instance: InstanceRef, verdict: SubmitVerdict): void {
    this.submitResponses.push({ instance, verdict });
  }

  cancelAsk(instance: InstanceRef): void {
    this.cancels.push(instance);
  }

  executeWorldRead(op: WorldReadOp, args: unknown[]): Promise<unknown> {
    const d = defer<unknown>();
    this.worldReads.push({ op, args, deferred: d });
    return d.promise;
  }

  
  executeArtifactPublish?: (request: ArtifactPublishRequest) => Promise<ArtifactVersionRecord> = (
    request,
  ) => {
    this.artifactPublishes.push(request);
    const record: ArtifactVersionRecord = {
      id: request.id,
      kind: request.op,
      version: request.version,
      contentType: request.op === "markdown" ? "text/markdown" : "application/pdf",
      bytes: (request.content ?? request.path ?? "").length,
      uri: `cf-artifact://fake/${request.id}/${request.version}`,
      ...(request.path === undefined ? {} : { sourcePath: request.path }),
      ...(titleOf(request.opts) === undefined ? {} : { title: titleOf(request.opts) }),
      publishedAt: 1,
    };
    this.artifactStore.set(`${request.id}@${request.version}`, record);
    if (this.options.deferArtifactPublishes === true) {
      const d = defer<ArtifactVersionRecord>();
      this.artifactDeferrals.push(d);
      return d.promise;
    }
    return Promise.resolve(record);
  };

  emit(event: RunEvent): void {
    this.events.push(event);
  }

  dispose(): void {
    this.disposeCalls++;
    this.eventsAtDispose ??= this.events.length;
  }

  
  startedInstanceKeys(): Set<string> {
    return new Set(this.startAsks.map((c) => refToString(c.instance)));
  }

  
  startAskCount(instance?: InstanceRef): number {
    if (instance === undefined) return this.startAsks.length;
    const key = refToString(instance);
    return this.startAsks.filter((c) => refToString(c.instance) === key).length;
  }

  
  eventsOfType<T extends RunEvent["type"]>(type: T): Array<Extract<RunEvent, { type: T }>> {
    return this.events.filter((e) => e.type === type) as Array<Extract<RunEvent, { type: T }>>;
  }

  
  cachedSettleOrder(): string[] {
    return this.events
      .filter((e): e is Extract<RunEvent, { type: "node-settled" }> => e.type === "node-settled" && e.cached === true)
      .map((e) => refToString(e.instance));
  }
}
