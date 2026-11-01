import { createContext, runInContext, type Context } from "node:vm";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { IifeContextExecutor, type ReplExecutor } from "./executors.js";
import {
  PROCESS_MODULE_IDS,
  createReplRequire,
  createRestrictedProcessFacade,
  normalizeReplError,
  stringifyReplResult,
} from "./node-repl-runtime-helpers.js";

export interface NodeReplImage {
  base64: string;
  mimeType: string;
}

export interface NodeReplStructuredResult {
  content: Array<{ type: string; [key: string]: unknown }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface NodeReplCuaAppIdentity {
  appKey: string;
  displayName?: string;
}

export interface NodeReplWriteSink {
  write(text: string): void;
  images: NodeReplImage[];
  browserScreenshots: NodeReplImage[];
  structuredResults: NodeReplStructuredResult[];
  responseMeta: Record<string, unknown>;
  cuaApps: NodeReplCuaAppIdentity[];
}

export interface NodeReplRunResult {
  
  result?: string;
  
  logs: string;
  
  error?: { name: string; message: string; stack?: string };
  
  images?: NodeReplImage[];
  
  browserScreenshotImageIndices?: number[];
  
  structuredResults?: NodeReplStructuredResult[];
  
  responseMeta?: Record<string, unknown>;
  
  cuaApp?: NodeReplCuaAppIdentity;
}

export type NodeReplRequestMeta = Record<string, unknown>;

export interface NodeReplSessionOptions {
  
  injectedGlobals?: Record<PropertyKey, unknown> | (() => Record<PropertyKey, unknown>);
  
  restrictProcess?: boolean;
}

function browserScreenshotIndexResult(
  images: readonly NodeReplImage[],
  browserScreenshots: readonly NodeReplImage[],
): Pick<NodeReplRunResult, "browserScreenshotImageIndices"> {
  if (images.length === 0 || browserScreenshots.length === 0) return {};

  const remainingByPayload = new Map<string, number>();
  for (const screenshot of browserScreenshots) {
    const key = `${screenshot.mimeType}\u0000${screenshot.base64}`;
    remainingByPayload.set(key, (remainingByPayload.get(key) ?? 0) + 1);
  }

  const browserScreenshotImageIndices: number[] = [];
  images.forEach((image, index) => {
    const key = `${image.mimeType}\u0000${image.base64}`;
    const remaining = remainingByPayload.get(key) ?? 0;
    if (remaining <= 0) return;
    browserScreenshotImageIndices.push(index);
    remainingByPayload.set(key, remaining - 1);
  });
  return browserScreenshotImageIndices.length > 0 ? { browserScreenshotImageIndices } : {};
}

function latestCuaAppResult(
  cuaApps: readonly NodeReplCuaAppIdentity[],
): Pick<NodeReplRunResult, "cuaApp"> {
  const cuaApp = cuaApps.at(-1);
  return cuaApp ? { cuaApp } : {};
}

export class NodeReplSession {
  private context: Context;
  private readonly createInjectedGlobals: () => Record<PropertyKey, unknown>;
  private readonly restrictedProcess: Readonly<Record<string, unknown>> | undefined;
  private currentSink: NodeReplWriteSink | null = null;
  private nodeReplApi: {
    requestMeta: NodeReplRequestMeta;
    emitStructuredResult: (result: unknown) => void;
  } | null = null;
  private disposed = false;
  private cleanupContextResources: () => void = () => undefined;
  
  private readonly executor: ReplExecutor;

  constructor(options: NodeReplSessionOptions = {}) {
    const injectedGlobals = options.injectedGlobals;
    this.createInjectedGlobals =
      typeof injectedGlobals === "function" ? injectedGlobals : () => injectedGlobals ?? {};
    this.restrictedProcess = options.restrictProcess ? createRestrictedProcessFacade() : undefined;
    this.executor = new IifeContextExecutor();
    this.context = this.buildContext();
  }

  private buildContext(): Context {
    const timeouts = new Set<ReturnType<typeof setTimeout>>();
    const intervals = new Set<ReturnType<typeof setInterval>>();
    const scopedSetTimeout = (
      callback: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      const handle = setTimeout(() => {
        timeouts.delete(handle);
        callback(...args);
      }, delay);
      timeouts.add(handle);
      return handle;
    };
    const scopedClearTimeout = (handle: ReturnType<typeof setTimeout>) => {
      timeouts.delete(handle);
      clearTimeout(handle);
    };
    const scopedSetInterval = (
      callback: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      const handle = setInterval(callback, delay, ...args);
      intervals.add(handle);
      return handle;
    };
    const scopedClearInterval = (handle: ReturnType<typeof setInterval>) => {
      intervals.delete(handle);
      clearInterval(handle);
    };
    this.cleanupContextResources = () => {
      for (const handle of timeouts) clearTimeout(handle);
      for (const handle of intervals) clearInterval(handle);
      timeouts.clear();
      intervals.clear();
    };
    const teeConsole = {
      log: (...args: unknown[]) => this.emit(args),
      info: (...args: unknown[]) => this.emit(args),
      warn: (...args: unknown[]) => this.emit(args),
      error: (...args: unknown[]) => this.emit(args),
      debug: (...args: unknown[]) => this.emit(args),
    };
    const req = createReplRequire(createRequire(`${process.cwd()}/`), this.restrictedProcess);
    const nodeReplApi = {
      cwd: process.cwd(),
      homeDir: homedir(),
      tmpDir: tmpdir(),
      requestMeta: {} as NodeReplRequestMeta,
      write: (text: string) => this.emit([text]),
      emitImage: (image: unknown) => this.emitImage(image),
      emitStructuredResult: (result: unknown) => this.emitStructuredResult(result),
      setResponseMeta: (meta: unknown) => this.setResponseMeta(meta),
    };
    this.nodeReplApi = nodeReplApi;
    const sandbox: Record<PropertyKey, unknown> = {
      console: teeConsole,
      process: this.restrictedProcess ?? process,
      Buffer,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      setTimeout: scopedSetTimeout,
      clearTimeout: scopedClearTimeout,
      setInterval: scopedSetInterval,
      clearInterval: scopedClearInterval,
      queueMicrotask,
      structuredClone,
      require: req,
      importModule: (specifier: string) => this.importModule(specifier),
      nodeRepl: nodeReplApi,
      ...this.createInjectedGlobals(),
    };
    const context = createContext(sandbox);
    runInContext("globalThis.globalThis = globalThis;", context);
    return context;
  }

  private emit(args: unknown[]): void {
    if (!this.currentSink) {
      return;
    }
    const text = args
      .map((a) => (typeof a === "string" ? a : (stringifyReplResult(a) ?? "undefined")))
      .join(" ");
    this.currentSink.write(text);
  }

  
  private emitImage(image: unknown): void {
    if (!this.currentSink) {
      return;
    }
    const directBytes =
      (ArrayBuffer.isView(image) && !(image instanceof DataView)) || Array.isArray(image)
        ? (image as Uint8Array | number[])
        : null;
    const rec =
      directBytes !== null
        ? { bytes: directBytes }
        : ((image ?? {}) as {
            base64?: unknown;
            bytes?: unknown;
            dataUrl?: unknown;
            mimeType?: unknown;
          });
    let base64: string | null = null;
    let dataUrlMimeType: string | undefined;
    if (typeof rec.dataUrl === "string") {
      const match = /^data:([^;,]+);base64,(.+)$/u.exec(rec.dataUrl);
      if (match) {
        dataUrlMimeType = match[1];
        base64 = match[2];
      }
    } else if (typeof rec.base64 === "string" && rec.base64.length > 0) {
      base64 = rec.base64;
    } else if (rec.bytes != null) {
      try {
        base64 = Buffer.from(rec.bytes as Uint8Array | readonly number[]).toString("base64");
      } catch {
        base64 = null;
      }
    }
    if (!base64) {
      throw new TypeError(
        "nodeRepl.emitImage requires bytes, dataUrl, { base64 }, or { bytes }; e.g. emitImage(await tab.screenshot())",
      );
    }
    const mimeType =
      typeof rec.mimeType === "string" && rec.mimeType
        ? rec.mimeType
        : (dataUrlMimeType ?? "image/png");
    this.currentSink.images.push({ base64, mimeType });
  }

  private setResponseMeta(meta: unknown): void {
    if (!this.currentSink) return;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      throw new TypeError("nodeRepl.setResponseMeta requires a plain object");
    }
    Object.assign(this.currentSink.responseMeta, meta as Record<string, unknown>);
  }

  private emitStructuredResult(result: unknown): void {
    if (!this.currentSink) return;
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new TypeError("nodeRepl.emitStructuredResult requires a result object");
    }
    const candidate = result as { content?: unknown };
    if (!Array.isArray(candidate.content)) {
      throw new TypeError("nodeRepl.emitStructuredResult requires a content array");
    }
    for (const block of candidate.content) {
      if (!block || typeof block !== "object" || typeof (block as { type?: unknown }).type !== "string") {
        throw new TypeError("nodeRepl.emitStructuredResult content blocks require a type");
      }
    }
    this.currentSink.structuredResults.push(result as NodeReplStructuredResult);
  }

  
  mergeResponseMeta(meta: Record<string, unknown>): void {
    if (!this.currentSink) return;
    const currentSurface = this.currentSink.responseMeta["cf/toolSurface"];
    const nextSurface = meta["cf/toolSurface"];
    if (
      currentSurface &&
      typeof currentSurface === "object" &&
      !Array.isArray(currentSurface) &&
      nextSurface &&
      typeof nextSurface === "object" &&
      !Array.isArray(nextSurface)
    ) {
      this.setResponseMeta({
        ...meta,
        "cf/toolSurface": {
          ...(currentSurface as Record<string, unknown>),
          ...(nextSurface as Record<string, unknown>),
        },
      });
      return;
    }
    this.setResponseMeta(meta);
  }

  
  recordBrowserScreenshot(image: NodeReplImage): void {
    if (!this.currentSink) return;
    this.currentSink.browserScreenshots.push(image);
  }

  
  recordCuaAppIdentity(app: NodeReplCuaAppIdentity): void {
    if (!this.currentSink) return;
    this.currentSink.cuaApps.push(app);
  }

  
  async run(
    code: string,
    options: {
      signal?: AbortSignal;
      requestMeta?: NodeReplRequestMeta;
      syncTimeoutMs?: number;
    } = {},
  ): Promise<NodeReplRunResult> {
    if (this.disposed) {
      return {
        logs: "",
        error: { name: "DisposedError", message: "REPL session 已释放" },
      };
    }
    let buffer = "";
    const images: NodeReplImage[] = [];
    const browserScreenshots: NodeReplImage[] = [];
    const structuredResults: NodeReplStructuredResult[] = [];
    const responseMeta: Record<string, unknown> = {};
    const cuaApps: NodeReplCuaAppIdentity[] = [];
    if (this.nodeReplApi) {
      this.nodeReplApi.requestMeta = { ...options.requestMeta };
    }
    this.currentSink = {
      write: (text: string) => {
        buffer += (buffer ? "\n" : "") + text;
      },
      images,
      browserScreenshots,
      structuredResults,
      responseMeta,
      cuaApps,
    };
    try {
      const value = await this.executor.run(
        code,
        this.context,
        options.signal,
        options.syncTimeoutMs,
      );
      return {
        result: stringifyReplResult(value),
        logs: buffer,
        ...(images.length > 0 ? { images } : {}),
        ...browserScreenshotIndexResult(images, browserScreenshots),
        ...(structuredResults.length > 0 ? { structuredResults } : {}),
        ...(Object.keys(responseMeta).length > 0 ? { responseMeta } : {}),
        ...latestCuaAppResult(cuaApps),
      };
    } catch (error) {
      const normalized = normalizeReplError(error);
      const mustResetKernel =
        normalized.name === "AbortError" ||
        normalized.name === "TimeoutError" ||
        normalized.message.includes("Script execution timed out");
      if (mustResetKernel && !this.disposed) {
        this.cleanupContextResources();
        this.context = this.buildContext();
        normalized.message = `${normalized.message}; kernel reset, all previous bindings were cleared; reinitialize browser/tab bindings before rerunning`;
      }
      return {
        logs: buffer,
        error: normalized,
        ...(images.length > 0 ? { images } : {}),
        ...browserScreenshotIndexResult(images, browserScreenshots),
        ...(structuredResults.length > 0 ? { structuredResults } : {}),
        ...(Object.keys(responseMeta).length > 0 ? { responseMeta } : {}),
        ...latestCuaAppResult(cuaApps),
      };
    } finally {
      this.currentSink = null;
      if (this.nodeReplApi) {
        this.nodeReplApi.requestMeta = {};
      }
    }
  }

  private async importModule(specifier: string): Promise<unknown> {
    if (this.restrictedProcess && PROCESS_MODULE_IDS.has(specifier)) {
      return { ...this.restrictedProcess, default: this.restrictedProcess };
    }
    return await import(specifier);
  }

  
  dispose(): void {
    this.disposed = true;
    this.cleanupContextResources();
    this.currentSink = null;
  }
}
