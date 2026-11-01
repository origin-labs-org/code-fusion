

export {
  type IDisposable,
  toDisposable,
  DisposableStore,
  Event,
  Emitter,
  Relay,
  EventMultiplexer,
  type CancellationToken,
  CancellationTokenSource,
} from "./foundation.js";

export { VSBuffer } from "./buffer.js";

export {
  type IReader,
  type IWriter,
  BufferReader,
  BufferWriter,
  serialize,
  deserialize,
} from "./serialization.js";

export {
  type IMessagePassingProtocol,
  type ConnectionFlowControl,
  type MessagePortFlowControl,
  type MessagePortFlowState,
  type MessagePortPayload,
  type ISocket,
  ChunkStream,
  SocketProtocol,
  ProtocolMessageType,
  ProtocolMessage,
  MessagePortProtocol,
  type MessagePortLike,
  createQueuePair,
} from "./protocol.js";
export { PersistentProtocol, type PersistentProtocolOptions } from "./persistent-protocol.js";

// Layer 3: Channel RPC
export {
  type IChannel,
  type IServerChannel,
  type IChannelServer,
  type IChannelClient,
  ChannelServer,
  ChannelClient,
  getDelayedChannel,
} from "./channels.js";

export {
  type ClientConnectionEvent,
  type Client,
  type IConnectionHub,
  type IClientRouter,
  IPCServer,
  IPCClient,
  StaticRouter,
} from "./ipc.js";

export { ProxyChannel } from "./proxy-channel.js";

export {
  type RPCLogger,
  LoggingChannelServer,
  LoggingChannelClient,
} from "./logging-middleware.js";

export {
  type NetworkTransportKind,
  type NetworkObservation,
  type NetworkTelemetrySink,
  setNetworkTelemetrySink,
  emitNetworkTelemetryObservation,
  NetworkTelemetryChannelServer,
  NetworkTelemetryChannelClient,
} from "./network-telemetry-middleware.js";

// Layer 6: Remote
export {
  RemoteConnectionType,
  WebSocketRemoteConnection,
  ManagedRemoteConnection,
  type RemoteConnection,
  type ResolvedAuthority,
  type IRemoteAuthorityResolver,
  RemoteAuthorityResolverService,
  type ISocketFactory,
  RemoteSocketFactoryService,
  type IURITransformer,
  type SimpleURI,
  createURITransformer,
  RemoteAgentConnection,
  type RemoteConnectionState,
} from "./remote.js";
