import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/client/stdio";
import type { JSONRPCMessage } from "@modelcontextprotocol/client";
import type { ChildProcess } from "node:child_process";
import { terminateMcpStdioProcessTree } from "./process-tree.js";
import {
  attachProcessToWindowsJobObject,
  type WindowsJobObjectController,
} from "./windows-job-object.js";

type SdkStdioDispose = (this: StdioClientTransport) => Promise<void>;

const sdkDispose = Object.getOwnPropertyDescriptor(StdioClientTransport.prototype, "_dispose")
  ?.value as SdkStdioDispose | undefined;

export type StdioRequestMetaProvider = () => Promise<Record<string, unknown> | undefined>;

export interface StdioProcessExitInfo {
  exitCode: number | null;
  exitedAt: number;
  signal: NodeJS.Signals | null;
  startedAt: number;
}

type ProcessTreeStdioServerParameters = StdioServerParameters & {
  
  requestMetaProvider?: StdioRequestMetaProvider;
};

export interface ProcessTreeStdioClientTransportOptions {
  windowsJobObjectFactory?: (
    pid: number,
  ) => Promise<WindowsJobObjectController | undefined>;
}

export class ProcessTreeStdioClientTransport extends StdioClientTransport {
  private childProcess?: ChildProcess;
  private lastProcessExit?: StdioProcessExitInfo;
  private readonly requestMetaProvider?: StdioRequestMetaProvider;
  private readonly windowsJobObjectFactory: (
    pid: number,
  ) => Promise<WindowsJobObjectController | undefined>;
  private windowsJobObject?: WindowsJobObjectController;

  constructor(
    server: ProcessTreeStdioServerParameters,
    options: ProcessTreeStdioClientTransportOptions = {},
  ) {
    super(server);
    this.requestMetaProvider = server.requestMetaProvider;
    this.windowsJobObjectFactory =
      options.windowsJobObjectFactory ?? attachProcessToWindowsJobObject;
  }

  async terminateWindowsJobObject(): Promise<void> {
    const windowsJobObject = this.windowsJobObject;
    this.windowsJobObject = undefined;
    if (!windowsJobObject) return;
    try {
      windowsJobObject.terminate();
    } catch {
    } finally {
      try {
        windowsJobObject.close();
      } catch {
      }
    }
  }

  override async send(message: JSONRPCMessage): Promise<void> {
    const requestMeta = await this.requestMetaProvider?.();
    await super.send(mergeRequestMeta(message, requestMeta));
  }

  override async start(): Promise<void> {
    const startedAt = Date.now();
    await super.start();
    const child = (this as unknown as { _process?: ChildProcess })._process;
    if (!child) return;
    this.childProcess = child;
    const recordExit = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      this.lastProcessExit ??= {
        exitCode,
        exitedAt: Date.now(),
        signal,
        startedAt,
      };
    };
    if (child.exitCode !== null || child.signalCode !== null) {
      recordExit(child.exitCode, child.signalCode);
      return;
    }
    child.once("exit", recordExit);

    if (process.platform !== "win32" || this.pid == null) return;
    try {
      this.windowsJobObject = await this.windowsJobObjectFactory(this.pid);
    } catch {
      this.windowsJobObject = undefined;
    }
  }

  get processExit(): StdioProcessExitInfo | undefined {
    return this.lastProcessExit;
  }

  get processAlive(): boolean {
    return Boolean(
      this.childProcess &&
      this.childProcess.exitCode === null &&
      this.childProcess.signalCode === null,
    );
  }
}

function mergeRequestMeta(
  message: JSONRPCMessage,
  requestMeta: Record<string, unknown> | undefined,
): JSONRPCMessage {
  if (!("method" in message) || !requestMeta || Object.keys(requestMeta).length === 0) {
    return message;
  }
  const params = isRecord(message.params) ? message.params : {};
  const existingMeta = isRecord(params._meta) ? params._meta : {};
  return {
    ...message,
    params: {
      ...params,
      _meta: { ...existingMeta, ...requestMeta },
    },
  } as JSONRPCMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

Object.defineProperty(ProcessTreeStdioClientTransport.prototype, "_dispose", {
  configurable: true,
  async value(this: ProcessTreeStdioClientTransport): Promise<void> {
    const pid = this.pid;
    await this.terminateWindowsJobObject();
    if (typeof pid === "number" && Number.isInteger(pid) && pid > 0) {
      try {
        await terminateMcpStdioProcessTree(pid);
      } catch {
      }
    }

    if (sdkDispose) {
      await sdkDispose.call(this);
      return;
    }
    await this.close();
  },
});
