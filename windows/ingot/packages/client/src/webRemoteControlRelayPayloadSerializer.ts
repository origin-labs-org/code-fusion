import {
  WEB_REMOTE_CONTROL_RPC_TRANSPORT_LIMITS,
  type WebRemoteControlAppPayload,
} from "@origin-ai/cf-shared";
import { type WebRemoteControlRelayV2OutgoingData } from "@origin-ai/cf-shared/web-remote-relay";

export type WebRemoteControlPayloadSendResult =
  | { kind: "sent"; bytes: number }
  | { kind: "unavailable" }
  | { kind: "oversize"; bytes: number; maxBytes: number };

export interface SerializedWebRemoteControlRelayPayload {
  readonly message: Omit<WebRemoteControlRelayV2OutgoingData, "payload"> & {
    payload: WebRemoteControlAppPayload;
  };
  readonly json: string;
  readonly bytes: number;
}

export class WebRemoteControlRelayPayloadSerializer {
  private readonly cache = new WeakMap<object, SerializedWebRemoteControlRelayPayload>();

  prepare(
    payload: WebRemoteControlAppPayload,
    clientTimestamp = Math.floor(Date.now() / 1000),
  ): SerializedWebRemoteControlRelayPayload {
    const cached = this.cache.get(payload);
    if (cached) return cached;
    const message: Omit<WebRemoteControlRelayV2OutgoingData, "payload"> & {
      payload: WebRemoteControlAppPayload;
    } = {
      type: "data",
      payload,
      client_ts: clientTimestamp,
    };
    const json = JSON.stringify(message);
    const prepared = Object.freeze({
      message,
      json,
      bytes: new TextEncoder().encode(json).byteLength,
    });
    this.cache.set(payload, prepared);
    return prepared;
  }

  isOversize(prepared: SerializedWebRemoteControlRelayPayload): boolean {
    return prepared.bytes > WEB_REMOTE_CONTROL_RPC_TRANSPORT_LIMITS.maxPhysicalFrameBytes;
  }
}
