import type {
  WebRemoteControlExternalWorkspaceBridge,
  WebRemoteControlMobileTaskView,
  WebRemoteControlMobileTaskViewUpdatePayload,
} from "@origin-ai/cf-shared";
import type { WebRemoteControlTerminalTransportState } from "#src/web-remote-control/contract.js";

export function createWebRemoteControlTaskViewPublisher(
  send: (payload: WebRemoteControlMobileTaskViewUpdatePayload) => boolean,
) {
  let bridge: WebRemoteControlExternalWorkspaceBridge | undefined;
  let view: WebRemoteControlMobileTaskView | null = null;
  let epoch: string | undefined;
  let seq = 0;
  let dirty = false;
  const matches = (target: WebRemoteControlExternalWorkspaceBridge) =>
    bridge?.bridgeSessionId === target.bridgeSessionId &&
    bridge?.bridgeGeneration === target.bridgeGeneration;
  const flush = () => {
    if (!bridge || !epoch || !dirty) return;
    dirty = !send({
      cf_type: "mobile-task-view-update",
      epoch,
      seq: ++seq,
      bridgeSessionId: bridge.bridgeSessionId,
      ...(bridge.bridgeGeneration !== undefined
        ? { bridgeGeneration: bridge.bridgeGeneration }
        : {}),
      view,
    });
  };
  const request = (nextEpoch: string) => {
    if (epoch !== nextEpoch) seq = 0;
    epoch = nextEpoch;
    dirty = true;
    flush();
  };
  const disconnected = () => {
    epoch = undefined;
    dirty = true;
  };
  return {
    request,
    seed(nextEpoch: string | undefined) {
      if (!epoch && nextEpoch) request(nextEpoch);
    },
    disconnected,
    suspend() {
      view = null;
      dirty = true;
      flush();
    },
    transportStateChanged(
      next: WebRemoteControlTerminalTransportState,
      previous: WebRemoteControlTerminalTransportState,
    ) {
      if (next === "paired") {
        flush();
      } else if (next !== "suspended" && !(next === "reconnecting" && previous === "suspended")) {
        disconnected();
      }
    },
    setBridge(next: WebRemoteControlExternalWorkspaceBridge) {
      if (matches(next)) return;
      bridge = next;
      view = null;
      dirty = true;
      flush();
    },
    update(
      source: WebRemoteControlExternalWorkspaceBridge,
      next: WebRemoteControlMobileTaskView | null,
    ) {
      if (!matches(source)) return;
      view = next;
      dirty = true;
      flush();
    },
    flush,
  };
}
