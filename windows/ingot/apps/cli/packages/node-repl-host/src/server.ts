
import { resolve } from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { INVALID_PARAMS, Server, type Tool } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { JsInputJsonSchema } from "@origin-ai/cf-contracts/tools/node-repl";
import {
  NodeReplSession,
  type NodeReplRequestMeta,
  type NodeReplRunResult,
} from "@origin-ai/cf-core/repl";
import { createComputerUseRuntime, type ComputerUseRuntime } from "@origin-ai/cf-cua";
import { z } from "zod";
import { createBrowserBridgeGlobals, type ActiveNodeReplCall } from "./browser-bridge.js";
import {
  createComputerUseBridgeGlobals,
  type ActiveCuaNodeReplCall,
  type NodeReplCuaBrokerConnection,
} from "./cua-bridge.js";
import { createNodeReplCuaBroker, type NodeReplCuaBroker } from "./cua-broker.js";
import {
  isDirectMcpEntrypoint,
  installNodeReplProcessGuards,
  installNodeReplShutdownTriggers,
} from "./process-lifecycle.js";
import { toMcpRunResult } from "./result.js";
import {
  JS_TOOL_DESCRIPTION,
  NODE_REPL_DEFAULT_TIMEOUT_MS,
  NODE_REPL_SERVER_INSTRUCTIONS,
  NODE_REPL_SERVER_VERSION,
} from "./tool-contract.js";

const MAX_SYNC_TIMEOUT_MS = 120_000;
const UNTRUSTED_SESSION_KEY = "__unscoped__";
const WORKER_KIND = "cf-node-repl-call";
export const NODE_REPL_MCP_PROCESS_TITLE = "cf-node-repl-mcp";
const pluginRoot = process.env.CF_PLUGIN_ROOT ?? process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
const browserDocumentationRoot = resolve(pluginRoot, "docs");
const cuaDocumentationRoot = resolve(
  process.env.CF_CUA_PLUGIN_ROOT ?? pluginRoot,
  "docs",
);
const jsInputSchema = z
  .object({
    code: z.string(),
    timeout_ms: z.number().int().min(1).max(MAX_SYNC_TIMEOUT_MS).optional(),
    title: z.string().min(1).max(120).optional(),
  })
  .strict();
const requestContextSchema = z
  .object({
    parent_span_id: z.string().optional(),
    runtime_scope: z.enum(["main", "subagent"]).default("main"),
    session_id: z.string().trim().min(1).optional(),
    span_id: z.string().optional(),
    trace_id: z.string().optional(),
    turn_id: z.string().optional(),
    workspace_identity: z.string().optional(),
    workspace_key: z.string().optional(),
    workspace_path: z.string().optional(),
    remote_session_id: z.string().optional(),
    client_mode: z.string().optional(),
    delivery_kind: z.string().optional(),
  })
  .passthrough();

const tools: Tool[] = [
  {
    name: "js",
    description: JS_TOOL_DESCRIPTION,
    inputSchema: JsInputJsonSchema as Tool["inputSchema"],
  },
];

export interface NodeReplExecuteInput {
  code: string;
  requestMeta: NodeReplRequestMeta;
  signal: AbortSignal;
  syncTimeoutMs: number;
  cuaBroker?: NodeReplCuaBrokerConnection;
}

export type NodeReplExecutor = (input: NodeReplExecuteInput) => Promise<NodeReplRunResult>;

export interface NodeReplMcpRuntime {
  dispose(): void;
  server: Server;
}

interface WorkerCallData {
  code: string;
  kind: typeof WORKER_KIND;
  requestMeta: NodeReplRequestMeta;
  syncTimeoutMs: number;
  cuaBroker?: NodeReplCuaBrokerConnection;
}

export function setNodeReplMcpProcessTitle(target: { title: string } = process): void {
  target.title = NODE_REPL_MCP_PROCESS_TITLE;
}

export function createInProcessNodeReplExecutor(): NodeReplExecutor {
  return async (input) => {
    let activeCall: ActiveNodeReplCall | undefined;
    let activeCuaCall: ActiveCuaNodeReplCall | undefined;
    let session: NodeReplSession;
    const generation = 1;
    session = new NodeReplSession({
      injectedGlobals: () =>
        ({
          ...createBrowserBridgeGlobals({
            documentationRoot: browserDocumentationRoot,
            generation,
            getActiveCall: () => activeCall,
            session: () => session,
          }),
          ...createComputerUseBridgeGlobals({
            broker: input.cuaBroker,
            generation,
            getActiveCall: () => activeCuaCall,
            session: () => session,
            documentationRoot: cuaDocumentationRoot,
          }),
        }),
      restrictProcess: true,
    });
    activeCall = {
      generation,
      requestMeta: input.requestMeta,
      signal: input.signal,
    };
    activeCuaCall = {
      generation,
      requestMeta: input.requestMeta,
      signal: input.signal,
    };
    try {
      return await session.run(input.code, {
        requestMeta: input.requestMeta,
        signal: input.signal,
        syncTimeoutMs: input.syncTimeoutMs,
      });
    } finally {
      activeCall = undefined;
      activeCuaCall = undefined;
      session.dispose();
    }
  };
}

export function createNodeReplMcpRuntime(
  input: { executeJs?: NodeReplExecutor; cuaRuntime?: ComputerUseRuntime } = {},
): NodeReplMcpRuntime {
  const executeJs = input.executeJs ?? executeJsInWorker;
  const cuaRuntime =
    input.cuaRuntime ?? captureComputerUseRuntimeFromEnvironment();
  const cuaBroker = cuaRuntime
    ? createNodeReplCuaBroker({ runtime: cuaRuntime, platform: process.platform })
    : undefined;
  const queues = new Map<string, Promise<void>>();
  const activeCalls = new Set<AbortController>();
  let disposed = false;

  const serialized = async <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const previous = queues.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const next = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    queues.set(key, next);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (queues.get(key) === next) queues.delete(key);
    }
  };

  const server = new Server(
    { name: "node_repl", version: NODE_REPL_SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: NODE_REPL_SERVER_INSTRUCTIONS },
  );

  server.setRequestHandler("tools/list", async () => ({ tools }));
  server.setRequestHandler("tools/call", async (request, extra) => {
    if (disposed) throw new Error("node_repl runtime is disposed");
    const name = request.params.name;
    const requestMeta = buildRequestMeta(extra.mcpReq._meta);
    const sessionKey = requestSessionKey(requestMeta);
    if (name === "js") {
      const args = parseToolInput(jsInputSchema, request.params.arguments, name);
      return await serialized(sessionKey, async () => {
        if (!args.code) {
          return {
            content: [{ type: "text" as const, text: "js expects non-empty JavaScript source" }],
            isError: true,
          };
        }
        const callController = new AbortController();
        activeCalls.add(callController);
        const timeoutMs = args.timeout_ms ?? NODE_REPL_DEFAULT_TIMEOUT_MS;
        const callMeta = { ...requestMeta, ...(args.title ? { title: args.title } : {}) };
        try {
          const signal = AbortSignal.any([
            extra.mcpReq.signal,
            callController.signal,
            AbortSignal.timeout(timeoutMs),
          ]);
          const run = await executeJs({
            code: args.code,
            requestMeta: callMeta,
            signal,
            syncTimeoutMs: Math.min(timeoutMs, MAX_SYNC_TIMEOUT_MS),
            cuaBroker: cuaBroker?.connection,
          });
          return toMcpRunResult(run);
        } finally {
          activeCalls.delete(callController);
        }
      });
    }
    invalidParams(`Tool ${name} not found`);
  });

  return {
    server,
    dispose: () => {
      disposed = true;
      for (const controller of activeCalls) controller.abort();
      activeCalls.clear();
      queues.clear();
      void cuaBroker?.close();
      void cuaRuntime?.dispose();
    },
  };
}

async function executeJsInWorker(input: NodeReplExecuteInput): Promise<NodeReplRunResult> {
  if (input.signal.aborted) throw input.signal.reason;
  const data: WorkerCallData = {
    code: input.code,
    kind: WORKER_KIND,
    requestMeta: input.requestMeta,
    syncTimeoutMs: input.syncTimeoutMs,
    cuaBroker: input.cuaBroker,
  };
  const worker = new Worker(new URL(import.meta.url), { workerData: data });
  return await new Promise<NodeReplRunResult>((resolveRun, rejectRun) => {
    let settled = false;
    const cleanup = () => {
      input.signal.removeEventListener("abort", onAbort);
      worker.removeAllListeners();
    };
    const finish = (error?: unknown, result?: NodeReplRunResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate().catch(() => undefined);
      if (error !== undefined) rejectRun(error);
      else if (result) resolveRun(result);
      else rejectRun(new Error("node_repl worker returned no result"));
    };
    const onAbort = () => finish(input.signal.reason ?? new DOMException("aborted", "AbortError"));
    input.signal.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (message: unknown) => finish(undefined, message as NodeReplRunResult));
    worker.once("error", finish);
    worker.once("exit", (code) => {
      if (!settled)
        finish(new Error(`node_repl worker exited before returning a result (${code})`));
    });
    if (input.signal.aborted) onAbort();
  });
}

function parseToolInput<T>(schema: z.ZodType<T>, input: unknown, toolName: string): T {
  const parsed = schema.safeParse(input ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  invalidParams(`${toolName}: ${issue?.message ?? "invalid arguments"}`);
}

function invalidParams(message: string): never {
  throw Object.assign(new Error(message), { code: INVALID_PARAMS });
}

function buildRequestMeta(meta: Record<string, unknown> | undefined): NodeReplRequestMeta {
  const parsed = requestContextSchema.safeParse(meta?.["com.cf/request-context"]);
  return parsed.success ? parsed.data : {};
}

function requestSessionKey(meta: NodeReplRequestMeta): string {
  const sessionId = meta.session_id;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : UNTRUSTED_SESSION_KEY;
}

export { installNodeReplProcessGuards, installNodeReplShutdownTriggers };

export async function main(): Promise<void> {
  setNodeReplMcpProcessTitle();
  const runtimes = new Set<NodeReplMcpRuntime>();
  const computerUseRuntime = captureComputerUseRuntimeFromEnvironment();
  const handle = serveStdio(
    () => {
      const runtime = createNodeReplMcpRuntime({ cuaRuntime: computerUseRuntime });
      runtimes.add(runtime);
      return runtime.server;
    },
    { legacy: "reject" },
  );
  let shutdownStarted = false;
  const shutdown = () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    for (const runtime of runtimes) runtime.dispose();
    void handle
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  installNodeReplProcessGuards({
    onOutputClosed: shutdown,
    process,
    writeStderr: (text) => process.stderr.write(text),
  });
  installNodeReplShutdownTriggers({ process, shutdown, stdin: process.stdin });
}

if (!isMainThread && isWorkerCallData(workerData)) {
  const execute = createInProcessNodeReplExecutor();
  const controller = new AbortController();
  void execute({
    code: workerData.code,
    requestMeta: workerData.requestMeta,
    signal: controller.signal,
    syncTimeoutMs: workerData.syncTimeoutMs,
    cuaBroker: workerData.cuaBroker,
  })
    .then((result) => parentPort?.postMessage(result))
    .catch((error) => {
      parentPort?.postMessage({
        logs: "",
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      } satisfies NodeReplRunResult);
    });
}

export function captureComputerUseRuntimeFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ComputerUseRuntime | undefined {
  const socketPath = env.CF_CUA_PERMISSION_BROKER_SOCKET?.trim();
  if (!socketPath) return undefined;
  return createComputerUseRuntime({
    brokerSocketPath: socketPath,
    refreshMarkerPath: env.CF_CUA_PERMISSION_BROKER_REFRESH_MARKER?.trim(),
  });
}

function isWorkerCallData(value: unknown): value is WorkerCallData {
  if (!value || typeof value !== "object") return false;
  return (value as { kind?: unknown }).kind === WORKER_KIND;
}

if (isMainThread && (await isDirectMcpEntrypoint(import.meta.url, process.argv[1]))) {
  void main().catch((error) => {
    process.stderr.write(
      `node_repl MCP server failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
