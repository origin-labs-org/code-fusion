import type { WebRemoteControlAppPayload, WebRemoteControlFailure } from "@origin-ai/cf-shared";
import { createFailure } from "#src/web-remote-control/adapters/relayMessage.js";

interface WebRemoteControlAppPayloadRequesterOptions {
  sendPayload(payload: WebRemoteControlAppPayload): boolean;
  timeoutMs?: number;
}

interface WebRemoteControlAppPayloadRequestOptions {
  timeoutMs?: number;
}

interface PendingAppPayloadRequest<TResponse extends WebRemoteControlAppPayload> {
  isMatch(payload: WebRemoteControlAppPayload): payload is TResponse;
  resolve(payload: TResponse): void;
  reject(error: WebRemoteControlFailure): void;
  timer: ReturnType<typeof setTimeout>;
}

interface WebRemoteControlRelayRequestRecoveryOptions {
  recoverTimeout?: boolean;
}

function isRecoverableRelayRequestFailure(
  error: unknown,
  options?: WebRemoteControlRelayRequestRecoveryOptions,
): boolean {
  const failure = error as Partial<WebRemoteControlFailure> | undefined;
  return (
    failure?.reason === "relay-unavailable" ||
    (options?.recoverTimeout === true && failure?.reason === "desktop-bootstrap-timeout")
  );
}

export function createWebRemoteControlRelayRequestRecovery(recoverConnection: () => Promise<void>) {
  let recoveryPromise: Promise<void> | undefined;

  async function recoverRelayRequestPath(): Promise<void> {
    if (!recoveryPromise) {
      recoveryPromise = recoverConnection().finally(() => {
        recoveryPromise = undefined;
      });
    }
    await recoveryPromise;
  }

  return async function requestWithRelayRecovery<T>(
    request: () => Promise<T>,
    options?: WebRemoteControlRelayRequestRecoveryOptions,
  ): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (!isRecoverableRelayRequestFailure(error, options)) {
        throw error;
      }
      await recoverRelayRequestPath();
      return request();
    }
  };
}

export function createWebRemoteControlAppPayloadRequester({
  sendPayload,
  timeoutMs: defaultTimeoutMs = 10_000,
}: WebRemoteControlAppPayloadRequesterOptions) {
  const pending = new Map<string, PendingAppPayloadRequest<WebRemoteControlAppPayload>>();

  function rejectRequest(requestId: string, failure: WebRemoteControlFailure): boolean {
    const request = pending.get(requestId);
    if (!request) {
      return false;
    }
    clearTimeout(request.timer);
    pending.delete(requestId);
    request.reject(failure);
    return true;
  }

  return {
    requestAppPayload<TResponse extends WebRemoteControlAppPayload>(
      payload: WebRemoteControlAppPayload & { requestId: string },
      isMatch: (payload: WebRemoteControlAppPayload) => payload is TResponse,
      options?: WebRemoteControlAppPayloadRequestOptions,
    ): Promise<TResponse> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(payload.requestId);
          reject(createFailure("desktop-bootstrap-timeout", "Desktop did not respond in time."));
        }, options?.timeoutMs ?? defaultTimeoutMs);
        pending.set(payload.requestId, {
          isMatch,
          resolve: resolve as (payload: WebRemoteControlAppPayload) => void,
          reject,
          timer,
        });
        if (!sendPayload(payload)) {
          clearTimeout(timer);
          pending.delete(payload.requestId);
          reject(
            createFailure(
              "relay-unavailable",
              "Web remote control transport is not ready to send payload.",
            ),
          );
        }
      });
    },

    acceptPayload(payload: WebRemoteControlAppPayload): boolean {
      if (
        (payload.cf_type === "app-error" || payload.cf_type === "workspace-bridge-error") &&
        payload.requestId
      ) {
        return rejectRequest(payload.requestId, createFailure(payload.reason, payload.error));
      }

      for (const [requestId, request] of pending) {
        if (!request.isMatch(payload)) {
          continue;
        }
        clearTimeout(request.timer);
        pending.delete(requestId);
        request.resolve(payload);
        return true;
      }
      return false;
    },

    rejectAll(failure: WebRemoteControlFailure): void {
      for (const [requestId, request] of pending) {
        clearTimeout(request.timer);
        pending.delete(requestId);
        request.reject(failure);
      }
    },

    dispose(): void {
      this.rejectAll(createFailure("desktop-disconnected", "Web remote control transport closed."));
    },
  };
}
