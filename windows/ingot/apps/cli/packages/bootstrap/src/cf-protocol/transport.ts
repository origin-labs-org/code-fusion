import type {
  CfProtocolError,
  CfProtocolMessage,
  CfProtocolNotification,
  CfProtocolRequest,
  CfProtocolRequestId,
  CfProtocolResponse,
} from "@origin-ai/cf-shared";
import {
  networkCaptureControlSchema,
  cfProtocolMessageSchema,
  cfProtocolMethods,
  cfProtocolNotifications,
} from "@origin-ai/cf-shared";
import type { Logger } from "@origin-ai/cf-contracts";

type CfProtocolOutgoingMessage =
  | CfProtocolError
  | CfProtocolNotification
  | CfProtocolRequest
  | CfProtocolResponse;

type CfProtocolMessageHandler = (
  message: CfProtocolMessage,
) => Promise<CfProtocolOutgoingMessage | undefined>;

const PROTOCOL_EOF_DRAIN_MS = 100;
const PLUGIN_READ_IMMEDIATE_METHODS = new Set<string>([
  cfProtocolMethods.pluginsDescribe,
  cfProtocolMethods.pluginsList,
  cfProtocolMethods.pluginsOverview,
]);
const MCP_APP_CONCURRENT_METHODS = new Set<string>([
  cfProtocolMethods.mcpReadResource,
  cfProtocolMethods.mcpUiOpenInstance,
  cfProtocolMethods.mcpUiCloseInstance,
  cfProtocolMethods.mcpUiValidateInstance,
  cfProtocolMethods.mcpUiCallTool,
  cfProtocolMethods.mcpUiSampling,
  cfProtocolMethods.mcpUiCancelSampling,
  cfProtocolMethods.mcpUiCancelCall,
  cfProtocolMethods.mcpUiReadResource,
  cfProtocolMethods.mcpUiListResources,
  cfProtocolMethods.mcpUiListResourceTemplates,
  cfProtocolMethods.mcpUiSubscribeResource,
  cfProtocolMethods.mcpUiUnsubscribeResource,
  cfProtocolMethods.mcpUiRegisterAppTools,
  cfProtocolMethods.mcpUiUnregisterAppTools,
  cfProtocolMethods.mcpUiClaimAppToolCall,
  cfProtocolMethods.mcpUiResolveAppToolCall,
]);

interface CfProtocolNdjsonConnectionOptions {
  signal?: AbortSignal;
  clearPostResponseMessages?: () => void;
  handleMessage: CfProtocolMessageHandler;
  input: NodeJS.ReadableStream;
  logger?: Logger;
  onTransportClosed?: (error: Error) => void;
  output: NodeJS.WritableStream;
  takePostResponseMessages?: (
    requestId: CfProtocolRequestId,
  ) => readonly CfProtocolOutgoingMessage[];
  takePostResponseBatch?: (requestId: CfProtocolRequestId) => {
    readonly messages: readonly CfProtocolOutgoingMessage[];
    commit(): boolean;
  } | null;
}

export class CfProtocolNdjsonConnection {
  private buffer = "";
  private processing: Promise<void> = Promise.resolve();
  private lastQueuedMessageStarted: Promise<void> = Promise.resolve();
  private readonly closedPromise: Promise<void>;
  private resolveClosed!: () => void;
  private rejectClosed!: (error: Error) => void;
  private terminal = false;
  private transportCloseNotified = false;
  private draining = false;
  private drainTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: CfProtocolNdjsonConnectionOptions) {
    this.closedPromise = new Promise((resolve, reject) => {
      this.resolveClosed = resolve;
      this.rejectClosed = reject;
    });
  }

  start(): void {
    this.options.input.on("data", this.onData);
    this.options.input.once("end", this.onClose);
    this.options.input.once("close", this.onClose);
    this.options.input.on("error", this.onError);
    this.options.output.on("error", this.onError);
    this.options.signal?.addEventListener("abort", this.onAbort, { once: true });
    if (this.options.signal?.aborted) this.onAbort();
  }

  waitForClose(): Promise<void> {
    return this.closedPromise;
  }

  send(message: CfProtocolOutgoingMessage): void {
    if (this.terminal) return;
    if (
      "method" in message &&
      message.method === cfProtocolNotifications.processNetworkRequests &&
      ((this.options.output as NodeJS.WritableStream & { writableLength?: number })
        .writableLength ?? 0) >=
        256 * 1024
    )
      return;
    try {
      this.options.output.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private readonly onData = (chunk: Buffer | string): void => {
    if (this.terminal || this.draining) return;
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.dispatchLine(line);
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
  };

  private readonly onClose = (): void => {
    if (this.terminal || this.draining) return;
    const trailing = this.buffer.trim();
    if (trailing.length > 0) {
      this.dispatchLine(trailing);
      this.buffer = "";
    }
    this.draining = true;
    this.notifyTransportClosed(new Error("CodeFusion Protocol client connection closed"));
    this.drainTimer = setTimeout(() => this.finish(), PROTOCOL_EOF_DRAIN_MS);
    void this.processing.then(
      () => this.finish(),
      (error: Error) => this.fail(error),
    );
  };

  private readonly onAbort = (): void => {
    this.notifyTransportClosed(new Error("CodeFusion Protocol runtime stopping"));
    this.finish();
  };

  private readonly onError = (error: Error): void => {
    this.notifyTransportClosed(error);
    this.fail(error);
  };

  private notifyTransportClosed(error: Error): void {
    if (this.transportCloseNotified) return;
    this.transportCloseNotified = true;
    this.options.onTransportClosed?.(error);
  }

  private finish(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.detachInput();
    this.options.clearPostResponseMessages?.();
    this.resolveClosed();
  }

  private fail(error: Error): void {
    if (this.terminal) return;
    this.terminal = true;
    this.notifyTransportClosed(error);
    this.detachInput();
    this.options.clearPostResponseMessages?.();
    this.rejectClosed(error);
  }

  private detachInput(): void {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.options.input.off("data", this.onData);
    this.options.input.off("end", this.onClose);
    this.options.input.off("close", this.onClose);
    this.options.signal?.removeEventListener("abort", this.onAbort);
  }

  private dispatchLine(line: string): void {
    if (this.terminal) return;
    const message = this.decodeLine(line);
    if (!message) {
      return;
    }
    if (
      !("id" in message) &&
      "method" in message &&
      message.method === cfProtocolMethods.processNetworkCapture
    ) {
      if (networkCaptureControlSchema.safeParse(message.params).success) {
        void this.handleMessage(message).catch(() => {
          
        });
      }
      return;
    }
    if ("id" in message && ("result" in message || "error" in message)) {
      void this.handleMessage(message).catch((error: unknown) => {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      });
      return;
    }
    if (
      "id" in message &&
      "method" in message &&
      PLUGIN_READ_IMMEDIATE_METHODS.has(message.method)
    ) {
      void this.handleMessage(message).catch((error: unknown) => {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      });
      return;
    }
    if (this.shouldBypassProcessingQueue(message)) {
      void this.lastQueuedMessageStarted
        .then(() => this.handleMessage(message))
        .catch((error: unknown) => {
          this.fail(error instanceof Error ? error : new Error(String(error)));
        });
      return;
    }
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    this.lastQueuedMessageStarted = started;
    this.processing = this.processing
      .then(async () => {
        const handling = this.handleMessage(message);
        markStarted();
        await handling;
      })
      .catch((error: unknown) => {
        markStarted();
        this.fail(error instanceof Error ? error : new Error(String(error)));
      });
  }

  private decodeLine(line: string): CfProtocolMessage | null {
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch (error) {
      this.options.logger?.warn("CodeFusion Protocol JSON parse failed", {
        error: error instanceof Error ? error.message : String(error),
        event: "cf_protocol.parse.failed",
        module: "bootstrap.cf_protocol",
        status: "failed",
      });
      this.sendError("parse-error", -32700, "Parse error");
      return null;
    }

    const parsed = cfProtocolMessageSchema.safeParse(decoded);
    if (!parsed.success) {
      this.sendError("invalid-message", -32600, "Invalid CodeFusion Protocol message", {
        issues: parsed.error.issues,
      });
      return null;
    }

    return parsed.data;
  }

  private shouldBypassProcessingQueue(message: CfProtocolMessage): boolean {
    return (
      "id" in message &&
      "method" in message &&
      (message.method === cfProtocolMethods.sessionStop ||
        message.method === cfProtocolMethods.workspaceCancelGenerateText ||
        MCP_APP_CONCURRENT_METHODS.has(message.method))
    );
  }

  private async handleMessage(message: CfProtocolMessage): Promise<void> {
    if (this.terminal) return;
    const response = await this.options.handleMessage(message);
    if (response) {
      const postResponseBatch =
        "id" in response && ("result" in response || "error" in response)
          ? (this.options.takePostResponseBatch?.(response.id) ?? {
              messages: this.options.takePostResponseMessages?.(response.id) ?? [],
              commit: () => true,
            })
          : { messages: [], commit: () => true };
      if (this.terminal) return;
      this.send(response);
      for (const postResponseMessage of postResponseBatch.messages) {
        this.send(postResponseMessage);
      }
      if (!this.terminal) postResponseBatch.commit();
    }
  }

  private sendError(id: string, code: number, message: string, data?: unknown): void {
    this.send({
      error: {
        code,
        data,
        message,
      },
      id,
    });
  }
}
