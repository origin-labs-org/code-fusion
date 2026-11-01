import { CfStorageStartupGate } from "#src/cf-agent/cfStorageStartupGate.js";
import { Emitter } from "@origin-ai/cf-rpc";
import type { IDisposable } from "@origin-ai/cf-rpc";
import type {
  CfProtocolMethod,
  CfProtocolNotification,
  CfProtocolRequest,
  CfProtocolRequestId,
  CfProtocolTrace,
} from "@origin-ai/cf-shared";
import type { V4Method } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { z } from "zod";
import type { CfProtocolTransport } from "./cfProtocolTransport.js";

export type CfProtocolClientMethod = CfProtocolMethod | V4Method;

interface CfProtocolClientOptions {
  requireStorageStartup?: boolean;
  requestTimeoutMs?: number;
}

export interface CfProtocolRequestTimeoutEvent {
  method: CfProtocolClientMethod;
  requestId: CfProtocolRequestId;
  timeoutMs: number;
}

interface PendingRequest<T> {
  method: string;
  observation: boolean;
  timeout: ReturnType<typeof setTimeout>;
  resumeTimeout: () => void;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  
  promise?: Promise<T>;
  resultSchema?: z.ZodType<T>;
  cleanupAbort?: () => void;
}

interface CfProtocolClientRequestOptions {
  
  lifecycle?: "operation" | "observation";
  signal?: AbortSignal;
  trace?: CfProtocolTrace;
  timeoutMs?: number;
}

export const DEFAULT_CF_PROTOCOL_REQUEST_TIMEOUT_MS = 3 * 60_000;

class CfProtocolClientError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "CfProtocolClientError";
  }
}

export class CfProtocolRequestTimeoutError extends Error {
  constructor(
    readonly method: CfProtocolClientMethod,
    readonly requestId: CfProtocolRequestId,
    readonly timeoutMs: number,
  ) {
    super(`CodeFusion Protocol request timed out: ${method}`);
    this.name = "CfProtocolRequestTimeoutError";
  }
}

export class CfProtocolClient implements IDisposable {
  readonly storageStartup: CfStorageStartupGate;
  private readonly pending = new Map<string, PendingRequest<unknown>>();
  private readonly notificationEmitter = new Emitter<CfProtocolNotification>();
  private readonly requestEmitter = new Emitter<CfProtocolRequest>();
  private readonly requestTimeoutEmitter = new Emitter<CfProtocolRequestTimeoutEvent>();
  private readonly pendingDrainedEmitter = new Emitter<void>();
  private readonly closeEmitter = new Emitter<void>();
  private readonly disposables: IDisposable[] = [];
  private nextRequestId = 1;
  private disposed = false;
  private readonly requestTimeoutMs: number;

  
  get isDisposed(): boolean {
    return this.disposed;
  }

  readonly onNotification = this.notificationEmitter.event;
  readonly onRequest = this.requestEmitter.event;
  readonly onRequestTimeout = this.requestTimeoutEmitter.event;
  readonly onPendingRequestsDrained = this.pendingDrainedEmitter.event;
  readonly onClose = this.closeEmitter.event;

  
  get pendingRequestCount(): number {
    return this.pending.size;
  }

  get pendingOperationRequestCount(): number {
    let count = 0;
    for (const pending of this.pending.values()) if (!pending.observation) count += 1;
    return count;
  }

  constructor(
    private readonly transport: CfProtocolTransport,
    options?: CfProtocolClientOptions,
  ) {
    this.storageStartup = new CfStorageStartupGate(options?.requireStorageStartup ?? false);
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_CF_PROTOCOL_REQUEST_TIMEOUT_MS;
    this.disposables.push(
      transport.onMessage((message) => this.handleMessage(message)),
      transport.onClose((event) => {
        this.storageStartup.dispose();
        const suffix = event.reason ? `: ${event.reason}` : "";
        this.rejectAll(new Error(`CodeFusion agent transport closed${suffix}`));
        this.closeEmitter.fire();
      }),
    );
  }

  get transportKind() {
    return this.transport.kind;
  }

  
  request<T = unknown>(
    method: CfProtocolClientMethod,
    params?: unknown,
    resultSchema?: z.ZodType<T>,
    options?: CfProtocolClientRequestOptions,
  ): Promise<T> {
    const requestPromise = this.requestImpl(method, params, resultSchema, options);
    void requestPromise.catch(() => undefined);
    return requestPromise;
  }

  private async requestImpl<T = unknown>(
    method: CfProtocolClientMethod,
    params?: unknown,
    resultSchema?: z.ZodType<T>,
    options?: CfProtocolClientRequestOptions,
  ): Promise<T> {
    this.assertNotDisposed();
    if (this.storageStartup.isWaiting) await this.storageStartup.wait(options?.signal);
    this.assertNotDisposed();
    options?.signal?.throwIfAborted();
    const id = this.nextRequestId++;
    const requestKey = String(id);
    const requestTimeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
    const observation = options?.lifecycle === "observation";

    const resultPromise = new Promise<T>((resolve, reject) => {
      const expire = () => {
        const pending = this.pending.get(requestKey);
        pending?.cleanupAbort?.();
        this.deletePending(requestKey);
        const error = new CfProtocolRequestTimeoutError(method, id, requestTimeoutMs);
        if (!observation) {
          this.requestTimeoutEmitter.fire({ method, requestId: id, timeoutMs: requestTimeoutMs });
        }
        reject(error);
      };
      const timeout = setTimeout(expire, requestTimeoutMs);

      const abortHandler = () => {
        const pending = this.pending.get(requestKey);
        if (!pending) return;
        clearTimeout(pending.timeout);
        pending.cleanupAbort?.();
        this.deletePending(requestKey);
        const reason = options?.signal?.reason;
        reject(
          reason instanceof Error ? reason : new DOMException("Request aborted", "AbortError"),
        );
      };
      const pending: PendingRequest<T> = {
        method,
        observation,
        timeout,
        resumeTimeout: () => {
          pending.timeout = setTimeout(expire, requestTimeoutMs);
        },
        resolve: resolve as (value: unknown) => void,
        reject,
        resultSchema,
        cleanupAbort: () => options?.signal?.removeEventListener("abort", abortHandler),
      };
      this.pending.set(requestKey, pending as PendingRequest<unknown>);
      if (options?.signal?.aborted) {
        abortHandler();
      } else {
        options?.signal?.addEventListener("abort", abortHandler, { once: true });
      }
    });

    const registeredPending = this.pending.get(requestKey);
    if (registeredPending) {
      registeredPending.promise = resultPromise;
    }

    if (!this.pending.has(requestKey)) {
      return resultPromise;
    }

    try {
      await this.transport.send({
        id,
        method,
        params,
        ...(options?.trace ? { trace: options.trace } : {}),
      });
    } catch (error) {
      const pending = this.pending.get(requestKey);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.cleanupAbort?.();
        this.deletePending(requestKey);
      }
      throw error;
    }

    return resultPromise;
  }

  async notify(method: CfProtocolClientMethod, params?: unknown): Promise<void> {
    this.assertNotDisposed();
    await this.transport.send({ method, params });
  }

  async respond(id: CfProtocolRequestId, result: unknown): Promise<void> {
    this.assertNotDisposed();
    await this.transport.send({ id, result });
  }

  async respondError(
    id: CfProtocolRequestId,
    error: { code: number; message: string; data?: unknown },
  ): Promise<void> {
    this.assertNotDisposed();
    await this.transport.send({ id, error });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disposeLocalResources();
    this.transport.dispose();
  }

  async disposeAndWait(): Promise<void> {
    const wasDisposed = this.disposed;
    if (!wasDisposed) {
      this.disposed = true;
      this.disposeLocalResources();
    }
    if (this.transport.disposeAndWait) {
      await this.transport.disposeAndWait();
      return;
    }
    if (!wasDisposed) {
      this.transport.dispose();
    }
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== "object") {
      return;
    }

    if ("result" in message && "id" in message) {
      this.resolveResponse(
        (message as { id: CfProtocolRequestId; result: unknown }).id,
        (message as { result: unknown }).result,
      );
      return;
    }

    if ("error" in message && "id" in message) {
      const errorMessage = message as {
        id: CfProtocolRequestId;
        error: { code: number; message: string; data?: unknown };
      };
      this.rejectResponse(
        errorMessage.id,
        new CfProtocolClientError(
          errorMessage.error.message,
          errorMessage.error.code,
          errorMessage.error.data,
        ),
      );
      return;
    }

    if ("method" in message && "id" in message) {
      this.requestEmitter.fire(message as CfProtocolRequest);
      return;
    }

    if ("method" in message) {
      if (
        message.method === "startup/storageState" &&
        this.storageStartup.accept((message as CfProtocolNotification).params)
      ) {
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timeout);
          if (this.storageStartup.snapshot?.phase === "ready") pending.resumeTimeout();
        }
        if (this.storageStartup.snapshot?.phase === "failed") {
          this.rejectAll(
            new Error(`SQLite startup failed: ${this.storageStartup.snapshot.errorCode}`),
          );
        }
      }
      this.notificationEmitter.fire(message as CfProtocolNotification);
    }
  }

  private resolveResponse(id: CfProtocolRequestId, result: unknown): void {
    const requestKey = String(id);
    const pending = this.pending.get(requestKey);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    pending.cleanupAbort?.();
    this.deletePending(requestKey);

    try {
      const parsed = pending.resultSchema ? pending.resultSchema.parse(result) : result;
      pending.resolve(parsed);
    } catch (error) {
      pending.reject(
        error instanceof Error
          ? error
          : new Error(`CodeFusion Protocol response parse failed: ${pending.method}`),
      );
    }
  }

  private rejectResponse(id: CfProtocolRequestId, error: Error): void {
    const requestKey = String(id);
    const pending = this.pending.get(requestKey);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    pending.cleanupAbort?.();
    this.deletePending(requestKey);
    pending.reject(error);
  }

  private rejectAll(error: Error): void {
    const hadPending = this.pendingOperationRequestCount > 0;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.cleanupAbort?.();
      void pending.promise?.catch(() => undefined);
      pending.reject(error);
    }
    this.pending.clear();
    if (hadPending && !this.disposed) {
      this.pendingDrainedEmitter.fire();
    }
  }

  private deletePending(requestKey: string): void {
    const pending = this.pending.get(requestKey);
    if (!this.pending.delete(requestKey)) {
      return;
    }
    if (!pending?.observation && this.pendingOperationRequestCount === 0 && !this.disposed) {
      this.pendingDrainedEmitter.fire();
    }
  }

  private disposeLocalResources(): void {
    this.rejectAll(new Error("CodeFusion Protocol client disposed"));
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.storageStartup.dispose();
    this.notificationEmitter.dispose();
    this.requestEmitter.dispose();
    this.requestTimeoutEmitter.dispose();
    this.pendingDrainedEmitter.dispose();
    this.closeEmitter.dispose();
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("CodeFusion Protocol client is disposed");
    }
  }
}
