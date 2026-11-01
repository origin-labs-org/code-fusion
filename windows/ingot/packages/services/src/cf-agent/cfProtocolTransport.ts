import type { Event, IDisposable } from "@origin-ai/cf-rpc";
import type { CfProtocolMessage } from "@origin-ai/cf-shared";

export type CfProtocolTransportKind = "stdio" | "websocket" | "memory";

export interface CfProtocolTransportClosedEvent {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  reason?: string;
}

export interface CfProtocolTransport extends IDisposable {
  readonly kind: CfProtocolTransportKind;
  readonly onMessage: Event<CfProtocolMessage>;
  readonly onClose: Event<CfProtocolTransportClosedEvent>;
  send(message: CfProtocolMessage): Promise<void>;
  disposeAndWait?(): Promise<void>;
}
