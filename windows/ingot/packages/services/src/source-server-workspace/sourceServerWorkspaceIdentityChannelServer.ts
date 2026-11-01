import {
  Event,
  type CancellationToken,
  type IChannelServer,
  type IServerChannel,
} from "@origin-ai/cf-rpc";
import { ServiceChannels } from "@origin-ai/cf-shared";
import {
  conversationTopicFrameSchema,
  encodeTopicWireFrames,
  measureTopicNotificationEnvelopeBytes,
  parseSessionsIndexTopic,
  parseWorkspaceConfigTopic,
  sessionsIndexTopic,
  sessionsIndexTopicFrameSchema,
  TopicWireFrameAssembler,
  V4_WIRE_PROTOCOL_VERSION,
  type TopicWireAssemblyFault,
  type TopicWireFrameCandidate,
  workspaceConfigTopic,
  workspaceConfigTopicFrameSchema,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { createServiceLogger } from "../logger/serviceLogger.js";

const log = createServiceLogger("source-server-workspace-identity");

export interface SourceServerWorkspaceIdentityMapping {
  stableIdentity: string;
  canonicalIdentity: string;
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function mapIdentityString(value: string, mappings: ReadonlyMap<string, string>): string {
  const exact = mappings.get(value);
  if (exact) return exact;

  const sessionsWorkspaceIdentity = parseSessionsIndexTopic(value);
  if (sessionsWorkspaceIdentity) {
    const mapped = mappings.get(sessionsWorkspaceIdentity);
    if (mapped) return sessionsIndexTopic(mapped);
  }
  const configWorkspaceIdentity = parseWorkspaceConfigTopic(value);
  if (configWorkspaceIdentity) {
    const mapped = mappings.get(configWorkspaceIdentity);
    if (mapped) return workspaceConfigTopic(mapped);
  }
  return value;
}

function mapValue(value: unknown, mappings: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return mapIdentityString(value, mappings);
  if (Array.isArray(value)) return value.map((item) => mapValue(item, mappings));
  if (!value || typeof value !== "object") return value;
  if (
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    value instanceof Date ||
    !isPlainRecord(value)
  ) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, mapValue(item, mappings)]),
  );
}

function isTopicWireCandidate(value: unknown): value is TopicWireFrameCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "complete" || candidate.kind === "fragment") &&
    typeof candidate.topic === "string" &&
    typeof candidate.subscriptionId === "string" &&
    typeof candidate.logicalFrameId === "string" &&
    typeof candidate.logicalFrameOrdinal === "number"
  );
}

function mapTopicWireEvent(
  event: Event<unknown>,
  mapper: SourceServerWorkspaceIdentityMapper,
  createAssembler: () => TopicWireFrameAssembler<unknown>,
): Event<unknown> {
  return (listener) => {
    const assembler = createAssembler();
    const emitFault = (fault: TopicWireAssemblyFault): void => {
      listener(
        mapper.mapOutgoing({
          wireVersion: V4_WIRE_PROTOCOL_VERSION,
          kind: "complete",
          ...(fault.deliveryKind ? { deliveryKind: fault.deliveryKind } : {}),
          logicalFrameId: fault.logicalFrameId,
          logicalFrameOrdinal: fault.logicalFrameOrdinal,
          topic: fault.topic,
          subscriptionId: fault.subscriptionId,
        }),
      );
    };
    return event((value) => {
      if (!isTopicWireCandidate(value)) {
        listener(mapper.mapOutgoing(value));
        return;
      }
      const assembled = assembler.accept(value);
      for (const item of assembled) {
        if (item.kind === "fault") {
          emitFault(item.fault);
          continue;
        }
        if (item.kind !== "complete") continue;
        const frame = mapper.mapOutgoing(item.frame) as {
          topic: string;
          subscriptionId: string;
        };
        try {
          const wires = encodeTopicWireFrames(frame, {
            deliveryKind: item.deliveryKind,
            topic: frame.topic,
            subscriptionId: frame.subscriptionId,
            logicalFrameId: value.logicalFrameId,
            logicalFrameOrdinal: value.logicalFrameOrdinal,
            measurePhysicalFrameBytes: (wire) =>
              measureTopicNotificationEnvelopeBytes(wire).maxBytes,
          });
          for (const wire of wires) listener(wire);
        } catch (error) {
          log.warn("failed to encode mapped topic frame", {
            topicLength: frame.topic.length,
            subscriptionId: frame.subscriptionId,
            error: error instanceof Error ? error.message : String(error),
          });
          emitFault({
            deliveryKind: item.deliveryKind,
            reasonCode: "proto.frameMappingEncodingFailed",
            logicalFrameId: value.logicalFrameId,
            logicalFrameOrdinal: value.logicalFrameOrdinal,
            topic: frame.topic,
            subscriptionId: frame.subscriptionId,
          });
        }
      }
    });
  };
}

export class SourceServerWorkspaceIdentityMapper {
  private readonly stableToCanonical = new Map<string, string>();
  private readonly canonicalToStable = new Map<string, string>();

  public register(mapping: SourceServerWorkspaceIdentityMapping): void {
    this.stableToCanonical.set(mapping.stableIdentity, mapping.canonicalIdentity);
    this.canonicalToStable.set(mapping.canonicalIdentity, mapping.stableIdentity);
  }

  public mapIncoming<T>(value: T): T {
    return mapValue(value, this.stableToCanonical) as T;
  }

  public mapOutgoing<T>(value: T): T {
    return mapValue(value, this.canonicalToStable) as T;
  }
}

class SourceServerWorkspaceIdentityServerChannel<TContext> implements IServerChannel<TContext> {
  public constructor(
    private readonly inner: IServerChannel<TContext>,
    private readonly mapper: SourceServerWorkspaceIdentityMapper,
  ) {}

  public async call<T>(
    context: TContext,
    command: string,
    args?: unknown,
    cancellationToken?: CancellationToken,
  ): Promise<T> {
    const result = await this.inner.call<T>(
      context,
      command,
      this.mapper.mapIncoming(args),
      cancellationToken,
    );
    return this.mapper.mapOutgoing(result);
  }

  public listen<T>(context: TContext, event: string, arg?: unknown): Event<T> {
    const innerEvent = this.inner.listen<unknown>(context, event, this.mapper.mapIncoming(arg));
    if (event === "onDynamicConversationFrame") {
      return mapTopicWireEvent(
        innerEvent,
        this.mapper,
        () => new TopicWireFrameAssembler(conversationTopicFrameSchema),
      ) as Event<T>;
    }
    if (event === "onDynamicSessionsIndexFrame") {
      return mapTopicWireEvent(
        innerEvent,
        this.mapper,
        () => new TopicWireFrameAssembler(sessionsIndexTopicFrameSchema),
      ) as Event<T>;
    }
    if (event === "onDynamicWorkspaceConfigFrame") {
      return mapTopicWireEvent(
        innerEvent,
        this.mapper,
        () => new TopicWireFrameAssembler(workspaceConfigTopicFrameSchema),
      ) as Event<T>;
    }
    return Event.map(innerEvent, (value) => this.mapper.mapOutgoing(value)) as Event<T>;
  }
}

export class SourceServerWorkspaceIdentityChannelServer<
  TContext = string,
> implements IChannelServer<TContext> {
  public constructor(
    private readonly inner: IChannelServer<TContext>,
    private readonly mapper: SourceServerWorkspaceIdentityMapper,
  ) {}

  public registerChannel(channelName: string, channel: IServerChannel<TContext>): void {
    this.inner.registerChannel(
      channelName,
      channelName === ServiceChannels.SourceServerWorkspace
        ? channel
        : new SourceServerWorkspaceIdentityServerChannel(channel, this.mapper),
    );
  }

  public ready(): void {
    this.inner.ready?.();
  }
}
