

import { VSBuffer } from "./buffer.js";
import { Event, Emitter, IDisposable, DisposableStore } from "./foundation.js";

// ============================================================================
// ============================================================================

export interface IMessagePassingProtocol {
  send(buffer: VSBuffer): void;
  readonly onMessage: Event<VSBuffer>;
  drain?(): Promise<void>;
}

export interface ConnectionFlowControl {
  readonly unacknowledgedBytes: number;
  readonly onSaturated: Event<void>;
  readonly onDrained: Event<void>;
}

export type MessagePortFlowState = "saturated" | "drained";

export interface MessagePortFlowControl {
  __cfRpcControl: "connection-flow-v1";
  state: MessagePortFlowState;
}

export type MessagePortPayload = Uint8Array | MessagePortFlowControl;

function isMessagePortFlowControl(value: unknown): value is MessagePortFlowControl {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.__cfRpcControl === "connection-flow-v1" &&
    (record.state === "saturated" || record.state === "drained") &&
    Object.keys(record).length === 2
  );
}

// ============================================================================
// ============================================================================

export interface ISocket extends IDisposable {
  onData: Event<VSBuffer>;
  onClose: Event<void>;
  onEnd: Event<void>;
  write(buffer: VSBuffer): void;
  end(): void;
  drain(): Promise<void>;
}

// ============================================================================
// ============================================================================

export class ChunkStream {
  private chunks: VSBuffer[] = [];
  private totalLength = 0;

  get byteLength(): number {
    return this.totalLength;
  }

  acceptChunk(chunk: VSBuffer): void {
    this.chunks.push(chunk);
    this.totalLength += chunk.byteLength;
  }

  
  peek(byteCount: number): VSBuffer | null {
    if (this.totalLength < byteCount) {
      return null;
    }

    if (this.chunks[0].byteLength >= byteCount) {
      return this.chunks[0].slice(0, byteCount);
    }

    const result = VSBuffer.alloc(byteCount);
    let offset = 0;
    for (const chunk of this.chunks) {
      if (offset >= byteCount) {
        break;
      }

      const remaining = byteCount - offset;
      const copyLength = Math.min(chunk.byteLength, remaining);
      result.set(copyLength === chunk.byteLength ? chunk : chunk.slice(0, copyLength), offset);
      offset += copyLength;
    }

    return result;
  }

  
  skip(byteCount: number): void {
    const discarded = this.read(byteCount);
    if (!discarded) {
      throw new Error(`ChunkStream.skip(${byteCount}) 超出可读范围`);
    }
  }

  
  read(byteCount: number): VSBuffer | null {
    if (this.totalLength < byteCount) {
      return null;
    }

    if (this.chunks[0].byteLength === byteCount) {
      const result = this.chunks.shift()!;
      this.totalLength -= byteCount;
      return result;
    }

    if (this.chunks[0].byteLength > byteCount) {
      const result = this.chunks[0].slice(0, byteCount);
      this.chunks[0] = this.chunks[0].slice(byteCount);
      this.totalLength -= byteCount;
      return result;
    }

    const result = VSBuffer.alloc(byteCount);
    let offset = 0;
    while (offset < byteCount) {
      const chunk = this.chunks[0];
      const needed = byteCount - offset;
      if (chunk.byteLength <= needed) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
        this.chunks.shift();
      } else {
        result.set(chunk.slice(0, needed), offset);
        this.chunks[0] = chunk.slice(needed);
        offset += needed;
      }
    }
    this.totalLength -= byteCount;
    return result;
  }
}

// ============================================================================
// ============================================================================

export enum ProtocolMessageType {
  None = 0,
  Regular = 1,
  Control = 2,
  Ack = 3,
  Disconnect = 5,
  ReplayRequest = 6,
  Pause = 7,
  Resume = 8,
  KeepAlive = 9,
}

export const HEADER_SIZE = 13; // 1 + 4 + 4 + 4

export class ProtocolMessage {
  constructor(
    public readonly type: ProtocolMessageType,
    public readonly id: number,
    public readonly ack: number,
    public readonly data: VSBuffer,
  ) {}

  get byteLength(): number {
    return HEADER_SIZE + this.data.byteLength;
  }
}

export function writeProtocolMessage(msg: ProtocolMessage): VSBuffer {
  const result = VSBuffer.alloc(HEADER_SIZE + msg.data.byteLength);
  result.writeUInt8(msg.type, 0);
  result.writeUInt32BE(msg.id, 1);
  result.writeUInt32BE(msg.ack, 5);
  result.writeUInt32BE(msg.data.byteLength, 9);
  result.set(msg.data, HEADER_SIZE);
  return result;
}

export class SocketProtocol implements IMessagePassingProtocol {
  private readonly _onMessage = new Emitter<VSBuffer>();
  readonly onMessage = this._onMessage.event;

  private readonly chunkStream = new ChunkStream();
  private readonly disposables = new DisposableStore();

  constructor(private socket: ISocket) {
    this.disposables.add(
      socket.onData((data) => {
        this.chunkStream.acceptChunk(data);
        this.readMessages();
      }),
    );
  }

  send(buffer: VSBuffer): void {
    this.writeMessage(new ProtocolMessage(ProtocolMessageType.Regular, 0, 0, buffer));
  }

  private writeMessage(msg: ProtocolMessage): void {
    this.socket.write(writeProtocolMessage(msg));
  }

  private readMessages(): void {
    while (true) {
      const header = this.chunkStream.peek(HEADER_SIZE);
      if (!header) {
        break;
      }

      const type = header.readUInt8(0) as ProtocolMessageType;
      const _id = header.readUInt32BE(1);
      const _ack = header.readUInt32BE(5);
      const length = header.readUInt32BE(9);

      const totalFrameLength = HEADER_SIZE + length;
      if (this.chunkStream.byteLength < totalFrameLength) {
        break;
      }

      this.chunkStream.skip(HEADER_SIZE);

      if (length === 0) {
        if (type === ProtocolMessageType.Regular) {
          this._onMessage.fire(VSBuffer.alloc(0));
        }
        continue;
      }

      const body = this.chunkStream.read(length);
      if (!body) {
        throw new Error("SocketProtocol 读取到完整帧长度后 body 不应为空");
      }

      if (type === ProtocolMessageType.Regular) {
        this._onMessage.fire(body);
      }
    }
  }

  async drain(): Promise<void> {
    return this.socket.drain();
  }

  dispose(): void {
    this.disposables.dispose();
    this._onMessage.dispose();
  }
}

// ============================================================================
// ============================================================================

export function createQueuePair(): [IMessagePassingProtocol, IMessagePassingProtocol] {
  const emitterA = new Emitter<VSBuffer>();
  const emitterB = new Emitter<VSBuffer>();

  const protocolA: IMessagePassingProtocol = {
    send: (buffer: VSBuffer) => {
      setTimeout(() => emitterB.fire(buffer), 0);
    },
    onMessage: emitterA.event,
  };

  const protocolB: IMessagePassingProtocol = {
    send: (buffer: VSBuffer) => {
      setTimeout(() => emitterA.fire(buffer), 0);
    },
    onMessage: emitterB.event,
  };

  return [protocolA, protocolB];
}

// ============================================================================
// ============================================================================

export interface MessagePortLike {
  addEventListener(type: "message", listener: (e: { data: MessagePortPayload }) => void): void;
  removeEventListener(type: "message", listener: (e: { data: MessagePortPayload }) => void): void;
  postMessage(message: MessagePortPayload): void;
  start(): void;
  close(): void;
}

export class MessagePortProtocol implements IMessagePassingProtocol {
  private readonly _onMessage = new Emitter<VSBuffer>();
  readonly onMessage = this._onMessage.event;
  private readonly _onFlowState = new Emitter<MessagePortFlowState>();
  readonly onFlowState = this._onFlowState.event;

  private readonly handler: (e: { data: MessagePortPayload }) => void;

  constructor(private port: MessagePortLike) {
    this.handler = (e: { data: MessagePortPayload }) => {
      if (isMessagePortFlowControl(e.data)) {
        this._onFlowState.fire(e.data.state);
        return;
      }
      if (e.data instanceof Uint8Array) this._onMessage.fire(VSBuffer.wrap(e.data));
    };
    this.port.addEventListener("message", this.handler);
    this.port.start();
  }

  send(buffer: VSBuffer): void {
    this.port.postMessage(buffer.buffer);
  }

  sendFlowState(state: MessagePortFlowState): void {
    this.port.postMessage({ __cfRpcControl: "connection-flow-v1", state });
  }

  disconnect(): void {
    this.port.removeEventListener("message", this.handler);
    this.port.close();
    this._onMessage.dispose();
    this._onFlowState.dispose();
  }
}
