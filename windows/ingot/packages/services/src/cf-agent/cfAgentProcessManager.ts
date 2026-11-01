import { localRuntimeNetworkCapture } from "#src/cf-agent/localRuntimeNetworkCapture.js";
import { resolveCfAgentSpawnCwd } from "#src/cf-agent/cfAgentSpawnCwd.js";
import type { CfAgentStorageStartupSnapshot } from "#src/cf-agent/cfAgent.js";

import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Emitter } from "@origin-ai/cf-rpc";
import { GEN_UI_OUTPUT_DIRECTORY, GEN_UI_OUTPUT_ROOT_ENV } from "@origin-ai/cf-shared/node";
import { getAppConfigDir } from "../paths.js";
import {
  parseCfProcessDiagnostic,
  CF_AGENT_LIFECYCLE_LOG_MARKER,
  CF_PROCESS_DIAGNOSTIC_NAME_MAX_CHARS,
  CF_PROCESS_DIAGNOSTIC_MESSAGE_MAX_CHARS,
  CF_PROCESS_DIAGNOSTIC_STACK_MAX_CHARS,
} from "@origin-ai/cf-shared/process-diagnostic";
import {
  CF_AGENT_RUNTIME,
  CF_AGENT_PROVIDER,
  CF_RUNTIME_ENV_KEY,
  resolveWorkspaceKey,
  resolveCfRuntimeEnv,
  sanitizeCfRuntimeEnv,
} from "@origin-ai/cf-shared";
import {
  findCfAgentRuntimeBinary,
  findCfAgentRuntimeNodeBundle,
} from "../runtime-tools/providerRuntimeResolver.js";
import { isEffectiveDevelopmentNodeEnv } from "#src/runtime-tools/nodeEnv.js";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { CfProtocolClient } from "./cfProtocolClient.js";
import { CfStdioTransport } from "./cfStdioTransport.js";
import { readCfStdioTapDevState } from "./cfStdioTapDevConfig.js";
import type { CfAgentPresentationSurface } from "./cfAgentPresentationSurface.js";
import { shouldSpawnInDetachedProcessGroup } from "../process/processTreeTerminator.js";
import type { RuntimeProcessLifecycleReporter } from "../process/runtimeProcessLifecycle.js";
import { buildAgentWorkspaceIdentityEnv } from "../runtime-tools/agentProxyEnv.js";

export interface CfAgentCommand {
  
  storagePreparationEntry?: string;
  
  supportsStorageStartup?: boolean;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface CfAgentCommandResolverContext {
  presentationSurface?: CfAgentPresentationSurface;
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceKey: string;
}

export type CfAgentCommandResolver = (
  context: CfAgentCommandResolverContext,
) => Promise<CfAgentCommand | null> | CfAgentCommand | null;

export interface CfAgentProcessManagerOptions {
  commandResolver?: CfAgentCommandResolver;
  presentationSurface?: CfAgentPresentationSurface;
  requestTimeoutMs?: number;
  processLifecycleReporter?: RuntimeProcessLifecycleReporter;
  
  lane?: string;
  
  idleTimeoutMs?: number;
  
  spawnFallbackCwd?: string;
  
  resolveSpawnEnv?: (context: {
    workspacePath: string;
    workspaceIdentity?: string;
    workspaceKey: string;
  }) => Promise<Record<string, string>> | Record<string, string>;
  
  waitForSpawnAdmission?: (context: {
    workspacePath: string;
    workspaceIdentity?: string;
    workspaceKey: string;
    signal?: AbortSignal;
  }) => Promise<void> | void;
}

interface ManagedCfAgentProcess {
  client: CfProtocolClient;
  child: ChildProcessWithoutNullStreams;
  cleanupPromise?: Promise<void>;
  exitDiagnosticsCompleted: Promise<void>;
  exited: boolean;
  firstCleanupReason?: AgentProcessCleanupReason;
  idleTimer?: ReturnType<typeof setTimeout>;
  readyAt?: number;
  readyReported: boolean;
  runtimeIdentity: CfAgentRuntimeIdentity;
  runtimeInstanceId: string;
  spawned: boolean;
  startedAt: number;
  terminationIntent?: AgentProcessTerminationIntent;
  workspace: {
    workspacePath: string;
    workspaceIdentity?: string;
  };
}

type AgentProcessCleanupReason =
  | "idle-timeout"
  | "idle-timeout-retry"
  | "manager-dispose"
  | "manager-dispose-retry"
  | "protocol-close"
  | "request-timeout"
  | "workspace-dispose"
  | "workspace-dispose-retry";

interface AgentProcessTerminationIntent {
  kind: "expected" | "watchdog_recycle";
  reason: Exclude<AgentProcessCleanupReason, "protocol-close">;
  requestedAt: number;
}

const E2E_COVERAGE_PRELOAD_SOURCE = `
const { takeCoverage } = require("node:v8");
const { writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const coverageDirectory = process.env.NODE_V8_COVERAGE;
let coverageFlushStarted = false;
for (const signal of process.platform === "win32"
  ? ["SIGINT", "SIGTERM"]
  : ["SIGINT", "SIGTERM", "SIGHUP"]) {
  const flushCoverage = () => {
    if (coverageFlushStarted) return;
    coverageFlushStarted = true;
    if (coverageDirectory) {
      writeFileSync(
        resolve(coverageDirectory, \`coverage-signal-\${process.pid}.marker\`),
        signal,
      );
    }
    try {
      takeCoverage();
    } catch (error) {
      if (coverageDirectory) {
        writeFileSync(
          resolve(coverageDirectory, \`coverage-signal-error-\${process.pid}.txt\`),
          error instanceof Error ? error.stack || error.message : String(error),
        );
      }
    }
    if (process.listenerCount(signal) !== 1) return;
    setTimeout(() => {
      process.exit(signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 129);
    }, 1000);
  };
  process.prependListener(signal, flushCoverage);
}
if (coverageDirectory) {
  writeFileSync(resolve(coverageDirectory, \`coverage-ready-\${process.pid}.marker\`), "");
}
`;

export function buildE2EAgentCoverageEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const artifactDir = env.CF_E2E_ARTIFACT_DIR?.trim();
  if (env.CF_E2E_COVERAGE !== "1" || !artifactDir) {
    return {};
  }
  const directory = resolve(artifactDir, "coverage", "raw", "cli");
  mkdirSync(directory, { recursive: true });
  const preloadPath = resolve(directory, "cf-e2e-coverage-preload.cjs");
  writeFileSync(preloadPath, E2E_COVERAGE_PRELOAD_SOURCE, "utf8");
  const requireOption = `--require=${JSON.stringify(preloadPath)}`;
  return {
    NODE_OPTIONS: [env.NODE_OPTIONS?.trim(), requireOption].filter(Boolean).join(" "),
    NODE_V8_COVERAGE: directory,
  };
}

export interface CfAgentRuntimeRestartedEvent {
  workspaceKey: string;
  runtimeIdentity: CfAgentRuntimeIdentity;
}

export interface CfAgentRuntimeLifecycleEvent {
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceKey: string;
  runtimeIdentity: CfAgentRuntimeIdentity;
  state: "available" | "unavailable";
}

export interface CfAgentRuntimeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
  
  lane?: string;
}

interface CfAgentSpawnPreflight {
  command: string;
  args: string[];
  requestedCwd: string;
  cwd: string;
  cwdSource: "command" | "workspace" | "workspace-fallback";
  commandPathKind: "absolute" | "path-search";
  commandExists: boolean | null;
  cwdExists: boolean;
}

const serviceLog = createServiceLogger("cf-agent");

const log = (...args: unknown[]) => serviceLog.info(undefined, ...args);
const warnLog = (...args: unknown[]) => serviceLog.warn(undefined, ...args);
const errorLog = (...args: unknown[]) => serviceLog.error(undefined, ...args);

const AGENT_STDERR_TAIL_MAX_LINES = 20;
const AGENT_STDERR_LINE_MAX_CHARS = 1_000;
const AGENT_STDERR_SENSITIVE_ASSIGNMENT_PATTERN =
  /(["']?(?:api[-_]?key|authorization|cookie|credential|password|secret|token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi;
const AGENT_STDERR_AUTH_SCHEME_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const AGENT_STDERR_API_KEY_PATTERN = /\b(sk-)[A-Za-z0-9_-]{16,}\b/gi;

function redactAgentDiagnostic(value: string): string {
  return (
    value
      .replace(AGENT_STDERR_SENSITIVE_ASSIGNMENT_PATTERN, "$1<redacted>")
      .replace(AGENT_STDERR_AUTH_SCHEME_PATTERN, "$1 <redacted>")
      .replace(AGENT_STDERR_API_KEY_PATTERN, "$1<redacted>")
  );
}

const debugLog = (...args: unknown[]) => {
  if (!isEffectiveDevelopmentNodeEnv()) {
    return;
  }
  serviceLog.debug(undefined, ...args);
};

function createAgentStderrTail(): {
  append(line: string): void;
  snapshot(): { lineCount: number; tail: string[] };
} {
  const tail: string[] = [];
  let lineCount = 0;

  return {
    append(line) {
      lineCount += 1;
      const redacted = redactAgentDiagnostic(line);
      const bounded =
        redacted.length > AGENT_STDERR_LINE_MAX_CHARS
          ? `${redacted.slice(0, AGENT_STDERR_LINE_MAX_CHARS)}…[truncated]`
          : redacted;
      tail.push(bounded);
      if (tail.length > AGENT_STDERR_TAIL_MAX_LINES) {
        tail.shift();
      }
    },
    snapshot() {
      return { lineCount, tail: [...tail] };
    },
  };
}

function parseArgsJson(raw: string | undefined): string[] | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("CF_AGENT_SERVER_ARGS_JSON must be a JSON string array");
  }
  return parsed;
}

function findUpward(relativePath: string): string | null {
  let current = process.cwd();
  while (true) {
    const candidate = join(current, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function buildCfAgentSpawnPreflight(
  command: CfAgentCommand,
  workspacePath: string,
  spawnFallbackCwd?: string,
): Promise<CfAgentSpawnPreflight> {
  const commandPathKind = isAbsolute(command.command) ? "absolute" : "path-search";
  const requestedCwd = command.cwd ?? workspacePath;
  const {
    cwd,
    usedFallback: shouldUseWorkspaceFallback,
    cwdExists,
  } = await resolveCfAgentSpawnCwd({ requestedCwd, workspacePath, spawnFallbackCwd });
  return {
    command: command.command,
    args: command.args ?? [],
    requestedCwd,
    cwd,
    cwdSource: shouldUseWorkspaceFallback
      ? "workspace-fallback"
      : command.cwd === undefined
        ? "workspace"
        : "command",
    commandPathKind,
    commandExists: commandPathKind === "absolute" ? existsSync(command.command) : null,
    cwdExists,
  };
}

function resolveBundledWorkspaceCfAgentCommand(
  context: CfAgentCommandResolverContext,
): CfAgentCommand | null {
  const distEntrypoint = findUpward("apps/cli/packages/cli/dist/cf.cjs");
  if (distEntrypoint) {
    const useBytecode =
      process.versions.electron && process.env.CF_DESKTOP_AGENT_BYTECODE === "1";
    const entrypoint = useBytecode
      ? join(dirname(distEntrypoint), "cf.bytecode.cjs")
      : distEntrypoint;
    if (useBytecode && !existsSync(entrypoint)) {
      throw new Error("桌面 Agent 字节码入口缺失，请运行 pnpm build:desktop-agent:bytecode");
    }
    return {
      command: process.execPath,
      args: [entrypoint, "app-server", "--stdio"],
      storagePreparationEntry: distEntrypoint,
      cwd: context.workspacePath,
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }

  const sourceEntrypoint = findUpward("apps/cli/packages/cli/src/main.ts");
  const tsxEntrypoint = findUpward("node_modules/.bin/tsx");
  if (!sourceEntrypoint || !tsxEntrypoint) {
    return null;
  }
  return {
    command: tsxEntrypoint,
    args: [sourceEntrypoint, "app-server", "--stdio"],
    cwd: context.workspacePath,
  };
}

function resolveDeployedCfAgentBinaryCommand(
  context: CfAgentCommandResolverContext,
): CfAgentCommand | null {
  const binaryPath = findCfAgentRuntimeBinary();
  if (!binaryPath) {
    return null;
  }
  return {
    command: binaryPath,
    args: CF_AGENT_RUNTIME.spawnArgs,
    cwd: context.workspacePath,
  };
}

function resolveElectronRuntimeCfAgentCommand(
  context: CfAgentCommandResolverContext,
): CfAgentCommand | null {
  if (!process.versions.electron) {
    return null;
  }
  const bundlePath = findCfAgentRuntimeNodeBundle();
  if (!bundlePath) {
    return null;
  }
  return {
    command: process.execPath,
    args: [bundlePath, ...CF_AGENT_RUNTIME.spawnArgs],
    storagePreparationEntry: bundlePath,
    cwd: context.workspacePath,
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}

export function resolveDefaultCfAgentCommand(
  context: CfAgentCommandResolverContext,
): CfAgentCommand | null {
  const command = process.env.CF_AGENT_SERVER_COMMAND?.trim();
  if (command) {
    return applyPresentationSurfaceToCommand(
      {
        command,
        args: parseArgsJson(process.env.CF_AGENT_SERVER_ARGS_JSON) ?? ["app-server", "--stdio"],
        cwd: process.env.CF_AGENT_SERVER_CWD?.trim() || context.workspacePath,
      },
      context.presentationSurface,
    );
  }

  const bundled =
    resolveBundledWorkspaceCfAgentCommand(context) ??
    resolveElectronRuntimeCfAgentCommand(context);
  return applyPresentationSurfaceToCommand(
    bundled
      ? { ...bundled, supportsStorageStartup: true }
      : resolveDeployedCfAgentBinaryCommand(context),
    context.presentationSurface,
  );
}

function applyPresentationSurfaceToCommand(
  command: CfAgentCommand | null,
  presentationSurface: CfAgentCommandResolverContext["presentationSurface"],
): CfAgentCommand | null {
  if (!command || presentationSurface !== "desktop") {
    return command;
  }

  const commandArgs = command.args ?? [];
  const args: string[] = [];
  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index]!;
    if (arg === "--surface") {
      const nextArg = commandArgs[index + 1];
      if (nextArg !== undefined && !nextArg.startsWith("-")) {
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--surface=")) {
      continue;
    }
    args.push(arg);
  }

  return {
    ...command,
    args: [...args, "--surface", "desktop"],
  };
}

export function wrapCfAgentCommandWithStdioTapDevProxy(
  command: CfAgentCommand,
  workspaceKey: string,
): CfAgentCommand {
  const tapState = readCfStdioTapDevState();
  if (!tapState.enabled) {
    return command;
  }

  const tapScript = findUpward("scripts/dev/cf-stdio-tap.mjs");
  if (!tapScript) {
    debugLog("CodeFusion stdio tap proxy enabled but script not found");
    return command;
  }

  return {
    supportsStorageStartup: command.supportsStorageStartup,
    command: process.execPath,
    args: [
      tapScript,
      "--workspace-key",
      workspaceKey,
      "--log-dir",
      tapState.logDir,
      "--",
      command.command,
      ...(command.args ?? []),
    ],
    cwd: command.cwd,
    env: {
      ...command.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
  };
}

export class CfAgentProcessManager {
  private readonly processesByWorkspaceKey = new Map<string, ManagedCfAgentProcess>();
  private readonly ownedProcesses = new Set<ManagedCfAgentProcess>();
  private readonly startingByWorkspaceKey = new Map<string, Promise<CfProtocolClient>>();
  private readonly restartGenerationByWorkspaceKey = new Map<string, number>();
  private readonly runtimeGenerationByWorkspaceKey = new Map<string, number>();
  private readonly availableRuntimeIdentityByWorkspaceKey = new Map<string, string>();
  private readonly startAdmissionAbortControllersByWorkspaceKey = new Map<
    string,
    Set<AbortController>
  >();
  private readonly storageStartupEmitter = new Emitter<{
    workspaceKey: string;
    snapshot: CfAgentStorageStartupSnapshot;
  }>();
  readonly onStorageStartupChanged = this.storageStartupEmitter.event;

  getStorageStartupState(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): CfAgentStorageStartupSnapshot | null {
    const managed = this.processesByWorkspaceKey.get(resolveWorkspaceKey(params));
    return managed
      ? {
          generation: managed.runtimeIdentity.generation,
          state: managed.client.storageStartup.snapshot ?? null,
        }
      : null;
  }

  private readonly commandResolver: CfAgentCommandResolver;
  private readonly presentationSurface: CfAgentProcessManagerOptions["presentationSurface"];
  private readonly requestTimeoutMs: number | undefined;
  private readonly processLifecycleReporter: RuntimeProcessLifecycleReporter | undefined;
  private readonly resolveSpawnEnv: CfAgentProcessManagerOptions["resolveSpawnEnv"];
  private readonly waitForSpawnAdmission: CfAgentProcessManagerOptions["waitForSpawnAdmission"];
  private readonly spawnFallbackCwd: string | undefined;
  private readonly lane: string | undefined;
  private readonly idleTimeoutMs: number | undefined;
  private readonly runtimeRestartedEmitter = new Emitter<CfAgentRuntimeRestartedEvent>();
  private readonly runtimeLifecycleEmitter = new Emitter<CfAgentRuntimeLifecycleEvent>();
  private disposeAllInFlight: Promise<void> | undefined;
  private disposed = false;

  
  readonly onRuntimeRestarted = this.runtimeRestartedEmitter.event;
  
  readonly onRuntimeLifecycle = this.runtimeLifecycleEmitter.event;

  constructor(options?: CfAgentProcessManagerOptions) {
    this.commandResolver = options?.commandResolver ?? resolveDefaultCfAgentCommand;
    this.presentationSurface = options?.presentationSurface;
    this.requestTimeoutMs = options?.requestTimeoutMs;
    this.processLifecycleReporter = options?.processLifecycleReporter;
    this.resolveSpawnEnv = options?.resolveSpawnEnv;
    this.waitForSpawnAdmission = options?.waitForSpawnAdmission;
    this.spawnFallbackCwd = options?.spawnFallbackCwd;
    this.lane = options?.lane?.trim() || undefined;
    this.idleTimeoutMs =
      options?.idleTimeoutMs && options.idleTimeoutMs > 0 ? options.idleTimeoutMs : undefined;
  }

  private reportProcessLifecycle(
    callback: (reporter: RuntimeProcessLifecycleReporter) => void,
  ): void {
    const reporter = this.processLifecycleReporter;
    if (!reporter) {
      return;
    }

    try {
      callback(reporter);
    } catch (error) {
      warnLog("CodeFusion agent process lifecycle reporter failed", error);
    }
  }

  private clearIdleTimer(managed: ManagedCfAgentProcess): void {
    if (managed.idleTimer) {
      clearTimeout(managed.idleTimer);
      delete managed.idleTimer;
    }
  }

  
  private scheduleIdleReclaim(workspaceKey: string, managed: ManagedCfAgentProcess): void {
    if (!this.idleTimeoutMs || this.disposed || managed.exited) {
      return;
    }
    this.clearIdleTimer(managed);
    const timer = setTimeout(() => {
      delete managed.idleTimer;
      if (this.disposed || managed.exited) {
        return;
      }
      if (this.processesByWorkspaceKey.get(workspaceKey) !== managed) {
        return;
      }
      if (
        managed.client.pendingOperationRequestCount > 0 ||
        managed.client.storageStartup.isWaiting
      ) {
        return;
      }
      log("CodeFusion agent process idle timeout; reclaiming", {
        workspaceKey,
        pid: managed.child.pid,
        runtimeIdentity: managed.runtimeIdentity.identity,
        idleTimeoutMs: this.idleTimeoutMs,
      });
      this.processesByWorkspaceKey.delete(workspaceKey);
      this.reportRuntimeUnavailable(managed);
      void this.cleanupManagedProcessWithRetry(
        managed,
        "idle-timeout",
        "idle-timeout-retry",
        "idle timeout",
      ).catch(() => undefined);
    }, this.idleTimeoutMs);
    timer.unref?.();
    managed.idleTimer = timer;
  }

  private recordTerminationIntent(
    managed: ManagedCfAgentProcess,
    reason: AgentProcessCleanupReason,
  ): void {
    if (managed.firstCleanupReason) {
      return;
    }
    managed.firstCleanupReason = reason;
    if (reason === "protocol-close") {
      return;
    }
    managed.terminationIntent = {
      kind: reason === "request-timeout" ? "watchdog_recycle" : "expected",
      reason,
      requestedAt: Date.now(),
    };
  }

  private reportRuntimeUnavailable(managed: ManagedCfAgentProcess): void {
    const workspaceKey = managed.runtimeIdentity.workspaceKey;
    if (
      this.availableRuntimeIdentityByWorkspaceKey.get(workspaceKey) !==
      managed.runtimeIdentity.identity
    ) {
      return;
    }
    this.availableRuntimeIdentityByWorkspaceKey.delete(workspaceKey);
    this.runtimeLifecycleEmitter.fire({
      workspacePath: managed.workspace.workspacePath,
      ...(managed.workspace.workspaceIdentity
        ? { workspaceIdentity: managed.workspace.workspaceIdentity }
        : {}),
      workspaceKey,
      runtimeIdentity: managed.runtimeIdentity,
      state: "unavailable",
    });
  }

  private reportRuntimeReady(managed: ManagedCfAgentProcess): void {
    if (
      !managed.spawned ||
      managed.exited ||
      managed.readyReported ||
      managed.readyAt == null ||
      typeof managed.child.pid !== "number"
    ) {
      return;
    }
    managed.readyReported = true;
    this.reportProcessLifecycle((reporter) =>
      reporter.onReady?.({
        pid: managed.child.pid!,
        provider: CF_AGENT_PROVIDER,
        ...(this.lane ? { lane: this.lane } : {}),
        workspacePath: managed.workspace.workspacePath,
        readyAt: managed.readyAt!,
        startupDurationMs: Math.max(0, managed.readyAt! - managed.startedAt),
        runtimeGeneration: managed.runtimeIdentity.generation,
        runtimeInstanceId: managed.runtimeInstanceId,
      }),
    );
  }

  private cleanupManagedProcess(
    managed: ManagedCfAgentProcess,
    reason: AgentProcessCleanupReason,
    options: { reportError?: boolean } = {},
  ): Promise<void> {
    this.recordTerminationIntent(managed, reason);
    this.clearIdleTimer(managed);
    if (managed.cleanupPromise) {
      return managed.cleanupPromise;
    }

    let cleanupCompleted = false;
    const cleanupPromise = managed.client
      .disposeAndWait()
      .then(async () => {
        await managed.exitDiagnosticsCompleted;
        cleanupCompleted = true;
        log("CodeFusion agent process cleanup completed", {
          workspaceKey: managed.runtimeIdentity.workspaceKey,
          pid: managed.child.pid,
          runtimeIdentity: managed.runtimeIdentity.identity,
          reason,
        });
      })
      .finally(() => {
        if (managed.cleanupPromise === cleanupPromise) {
          delete managed.cleanupPromise;
        }
        if (cleanupCompleted) {
          this.ownedProcesses.delete(managed);
        }
      });
    managed.cleanupPromise = cleanupPromise;
    void cleanupPromise.catch((error) => {
      if (options.reportError === false) {
        return;
      }
      errorLog("CodeFusion agent process cleanup failed", {
        workspaceKey: managed.runtimeIdentity.workspaceKey,
        pid: managed.child.pid,
        runtimeIdentity: managed.runtimeIdentity.identity,
        reason,
        error,
      });
    });
    return cleanupPromise;
  }

  private async cleanupManagedProcessForShutdown(managed: ManagedCfAgentProcess): Promise<void> {
    await this.cleanupManagedProcessWithRetry(
      managed,
      "manager-dispose",
      "manager-dispose-retry",
      "manager dispose",
    );
  }

  private async cleanupManagedProcessWithRetry(
    managed: ManagedCfAgentProcess,
    reason: AgentProcessCleanupReason,
    retryReason: AgentProcessCleanupReason,
    retryScope: string,
  ): Promise<void> {
    try {
      await this.cleanupManagedProcess(managed, reason, { reportError: false });
    } catch (firstError) {
      const cleanupError = firstError as NodeJS.ErrnoException;
      warnLog(`CodeFusion agent process cleanup retrying during ${retryScope}`, {
        workspaceKey: managed.runtimeIdentity.workspaceKey,
        pid: managed.child.pid,
        runtimeIdentity: managed.runtimeIdentity.identity,
        cleanupStage: reason,
        errorName: firstError instanceof Error ? firstError.name || "Error" : "UnknownError",
        ...(typeof cleanupError.code === "string" ? { errorCode: cleanupError.code } : {}),
        error: firstError,
      });
      try {
        await this.cleanupManagedProcess(managed, retryReason, { reportError: false });
      } catch (finalError) {
        errorLog("CodeFusion agent process cleanup failed", {
          workspaceKey: managed.runtimeIdentity.workspaceKey,
          pid: managed.child.pid,
          runtimeIdentity: managed.runtimeIdentity.identity,
          reason: retryReason,
          retryScope,
          error: finalError,
        });
        throw finalError;
      }
    }
  }

  async getClient(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<CfProtocolClient> {
    if (this.disposed) {
      throw new Error("CodeFusion agent process manager is disposed.");
    }
    const workspaceKey = resolveWorkspaceKey(params);
    const existing = this.processesByWorkspaceKey.get(workspaceKey);
    if (existing && !existing.child.killed) {
      return existing.client;
    }

    const starting = this.startingByWorkspaceKey.get(workspaceKey);
    if (starting) {
      const waitStartedAt = Date.now();
      log("CodeFusion agent process start already in progress", {
        workspaceKey,
      });
      const client = await starting;
      log("CodeFusion agent process start wait completed", {
        workspaceKey,
        durationMs: Date.now() - waitStartedAt,
      });
      return client;
    }

    const startGeneration = this.restartGenerationByWorkspaceKey.get(workspaceKey) ?? 0;
    const admissionAbortController = new AbortController();
    let controllers = this.startAdmissionAbortControllersByWorkspaceKey.get(workspaceKey);
    if (!controllers) {
      controllers = new Set<AbortController>();
      this.startAdmissionAbortControllersByWorkspaceKey.set(workspaceKey, controllers);
    }
    controllers.add(admissionAbortController);
    const startPromise = this.startClient(
      params,
      workspaceKey,
      startGeneration,
      admissionAbortController.signal,
    );
    this.startingByWorkspaceKey.set(workspaceKey, startPromise);
    try {
      return await startPromise;
    } finally {
      controllers.delete(admissionAbortController);
      if (controllers.size === 0) {
        this.startAdmissionAbortControllersByWorkspaceKey.delete(workspaceKey);
      }
      if (this.startingByWorkspaceKey.get(workspaceKey) === startPromise) {
        this.startingByWorkspaceKey.delete(workspaceKey);
      }
    }
  }

  
  getExistingClient(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): CfProtocolClient | undefined {
    const managed = this.processesByWorkspaceKey.get(resolveWorkspaceKey(params));
    return managed && !managed.child.killed ? managed.client : undefined;
  }

  
  listManagedProcesses(): Array<{
    pid: number;
    workspacePath: string;
    workspaceIdentity?: string;
    lane?: string;
    client: CfProtocolClient;
  }> {
    const result: Array<{
      pid: number;
      workspacePath: string;
      workspaceIdentity?: string;
      lane?: string;
      client: CfProtocolClient;
    }> = [];
    for (const managed of this.processesByWorkspaceKey.values()) {
      if (managed.exited || managed.child.killed || typeof managed.child.pid !== "number") continue;
      result.push({
        pid: managed.child.pid,
        workspacePath: managed.workspace.workspacePath,
        ...(managed.workspace.workspaceIdentity
          ? { workspaceIdentity: managed.workspace.workspaceIdentity }
          : {}),
        ...(this.lane ? { lane: this.lane } : {}),
        client: managed.client,
      });
    }
    return result;
  }

  
  markReady(
    params: { workspacePath: string; workspaceIdentity?: string },
    client: CfProtocolClient,
  ): void {
    const managed = this.processesByWorkspaceKey.get(resolveWorkspaceKey(params));
    if (!managed || managed.client !== client || managed.readyAt != null || managed.exited) {
      return;
    }
    managed.readyAt = Date.now();
    this.reportRuntimeReady(managed);
  }

  private async startClient(
    params: {
      workspacePath: string;
      workspaceIdentity?: string;
    },
    workspaceKey: string,
    startGeneration: number,
    admissionSignal: AbortSignal,
  ): Promise<CfProtocolClient> {
    const startStartedAt = Date.now();
    const resolveCommandStartedAt = Date.now();
    const command = await this.commandResolver({
      ...params,
      ...(this.presentationSurface ? { presentationSurface: this.presentationSurface } : {}),
      workspaceKey,
    });
    const resolveCommandDurationMs = Date.now() - resolveCommandStartedAt;
    if (!command) {
      throw new Error(
        "CodeFusion agent server command is not configured. Set CF_AGENT_SERVER_COMMAND before integration.",
      );
    }
    if (admissionSignal.aborted) {
      throw admissionSignal.reason ?? new Error("CodeFusion agent process start was cancelled.");
    }
    const effectiveCommand = wrapCfAgentCommandWithStdioTapDevProxy(command, workspaceKey);
    log("CodeFusion agent command resolved", {
      workspaceKey,
      command: command.command,
      effectiveCommand: effectiveCommand.command,
      resolveCommandDurationMs,
    });

    await this.waitForSpawnAdmission?.({ ...params, workspaceKey, signal: admissionSignal });

    const spawnEnv = (await this.resolveSpawnEnv?.({ ...params, workspaceKey })) ?? {};
    if (this.disposed) {
      throw new Error("CodeFusion agent process manager is disposed.");
    }
    if ((this.restartGenerationByWorkspaceKey.get(workspaceKey) ?? 0) !== startGeneration) {
      throw new Error("CodeFusion agent process start was cancelled.");
    }
    const spawnPreflight = await buildCfAgentSpawnPreflight(
      effectiveCommand,
      params.workspacePath,
      this.spawnFallbackCwd,
    );
    admissionSignal.throwIfAborted();
    await this.waitForSpawnAdmission?.({ ...params, workspaceKey, signal: admissionSignal });
    if (this.disposed) {
      throw new Error("CodeFusion agent process manager is disposed.");
    }
    if ((this.restartGenerationByWorkspaceKey.get(workspaceKey) ?? 0) !== startGeneration) {
      throw new Error("CodeFusion agent process start was cancelled.");
    }
    const runtimeEnv = resolveCfRuntimeEnv(process.env);
    log("CodeFusion agent spawn preflight", {
      workspaceKey,
      spawnPreflight,
    });
    const spawnRequestedAt = Date.now();
    const child = spawn(effectiveCommand.command, spawnPreflight.args, {
      cwd: spawnPreflight.cwd,
      detached: shouldSpawnInDetachedProcessGroup(),
      env: {
        ...sanitizeCfRuntimeEnv(process.env),
        [CF_RUNTIME_ENV_KEY]: runtimeEnv,
        ...spawnEnv,
        ...effectiveCommand.env,
        [GEN_UI_OUTPUT_ROOT_ENV]: join(getAppConfigDir(), GEN_UI_OUTPUT_DIRECTORY),
        ...buildAgentWorkspaceIdentityEnv(params.workspaceIdentity),
        ...buildE2EAgentCoverageEnv(),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const startedAt = Date.now();
    const stderrTail = createAgentStderrTail();
    const transport = new CfStdioTransport(child, {
      onStderrLine: (line) => {
        const diagnostic = parseCfProcessDiagnostic(line);
        if (diagnostic && typeof child.pid === "number") {
          this.reportProcessLifecycle((reporter) =>
            reporter.onException?.({
              pid: child.pid!,
              provider: CF_AGENT_PROVIDER,
              ...(this.lane ? { lane: this.lane } : {}),
              workspacePath: params.workspacePath,
              runtimeGeneration,
              runtimeInstanceId,
              diagnostic: {
                ...diagnostic,
                name: redactAgentDiagnostic(diagnostic.name).slice(
                  0,
                  CF_PROCESS_DIAGNOSTIC_NAME_MAX_CHARS,
                ),
                message: redactAgentDiagnostic(diagnostic.message).slice(
                  0,
                  CF_PROCESS_DIAGNOSTIC_MESSAGE_MAX_CHARS,
                ),
                ...(diagnostic.stack !== undefined
                  ? {
                      stack: redactAgentDiagnostic(diagnostic.stack).slice(
                        0,
                        CF_PROCESS_DIAGNOSTIC_STACK_MAX_CHARS,
                      ),
                    }
                  : {}),
              },
            }),
          );
          return;
        }
        stderrTail.append(line);
        debugLog(line);
      },
      ownedProcessStartedAtMs: spawnRequestedAt,
      ...(process.platform !== "win32" && child.pid ? { ownedProcessGroupId: child.pid } : {}),
    });
    const client = new CfProtocolClient(transport, {
      requireStorageStartup: effectiveCommand.supportsStorageStartup,
      requestTimeoutMs: this.requestTimeoutMs,
    });
    if (child.pid) {
      const unregisterNetworkCapture = localRuntimeNetworkCapture.register(client, child.pid);
      child.once("close", unregisterNetworkCapture);
    }
    const runtimeGeneration = (this.runtimeGenerationByWorkspaceKey.get(workspaceKey) ?? 0) + 1;
    this.runtimeGenerationByWorkspaceKey.set(workspaceKey, runtimeGeneration);
    const runtimeInstanceId = `agent-${randomUUID()}`;
    const runtimeIdentity: CfAgentRuntimeIdentity = {
      generation: runtimeGeneration,
      identity: this.lane
        ? `${workspaceKey}:${runtimeGeneration}:${child.pid ?? "unknown"}:${this.lane}`
        : `${workspaceKey}:${runtimeGeneration}:${child.pid ?? "unknown"}`,
      ...(typeof child.pid === "number" ? { processId: child.pid } : {}),
      ...(this.lane ? { lane: this.lane } : {}),
      workspaceKey,
    };
    const exitDiagnostics = Promise.withResolvers<void>();
    const managed: ManagedCfAgentProcess = {
      child,
      client,
      exited: false,
      exitDiagnosticsCompleted: exitDiagnostics.promise,
      readyReported: false,
      runtimeIdentity,
      runtimeInstanceId,
      spawned: false,
      startedAt,
      workspace: {
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
      },
    };
    this.processesByWorkspaceKey.set(workspaceKey, managed);
    this.ownedProcesses.add(managed);
    const publishStorage = () => {
      if (this.processesByWorkspaceKey.get(workspaceKey) !== managed) return;
      if (client.storageStartup.isWaiting) this.clearIdleTimer(managed);
      else if (
        client.storageStartup.snapshot?.phase === "ready" &&
        client.pendingOperationRequestCount === 0
      ) {
        this.scheduleIdleReclaim(workspaceKey, managed);
      }
      this.storageStartupEmitter.fire({
        workspaceKey,
        snapshot: { generation: runtimeGeneration, state: client.storageStartup.snapshot ?? null },
      });
    };
    client.storageStartup.onDidChange(publishStorage);
    publishStorage();
    if (this.idleTimeoutMs) {
      client.onPendingRequestsDrained(() => this.scheduleIdleReclaim(workspaceKey, managed));
    }
    child.once("spawn", () => {
      managed.spawned = true;
      if (runtimeGeneration > 1 && this.processesByWorkspaceKey.get(workspaceKey) === managed) {
        this.runtimeRestartedEmitter.fire({ workspaceKey, runtimeIdentity });
      }
      if (this.processesByWorkspaceKey.get(workspaceKey) === managed) {
        this.availableRuntimeIdentityByWorkspaceKey.set(workspaceKey, runtimeIdentity.identity);
        this.runtimeLifecycleEmitter.fire({
          workspacePath: params.workspacePath,
          ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
          workspaceKey,
          runtimeIdentity,
          state: "available",
        });
      }
      if (typeof child.pid === "number") {
        this.reportProcessLifecycle((reporter) =>
          reporter.onSpawn({
            pid: child.pid!,
            provider: CF_AGENT_PROVIDER,
            ...(this.lane ? { lane: this.lane } : {}),
            workspacePath: params.workspacePath,
            command: effectiveCommand.command,
            args: effectiveCommand.args ?? [],
            startedAt,
            runtimeGeneration,
            runtimeInstanceId,
          }),
        );
      }
      this.reportRuntimeReady(managed);
      log("CodeFusion agent process started", {
        workspaceKey,
        command: effectiveCommand.command,
        cwd: spawnPreflight.cwd,
        pid: child.pid,
        durationMs: Date.now() - startStartedAt,
      });
    });
    child.once("error", (error) => {
      errorLog(
        `CodeFusion agent process error${this.processLifecycleReporter?.onError ? ` ${CF_AGENT_LIFECYCLE_LOG_MARKER}` : ""}`,
        {
          workspaceKey,
          pid: child.pid,
          runtimeIdentity: runtimeIdentity.identity,
          errorName: error.name,
          errorMessage: error.message,
          errorStack: error.stack,
          spawnPreflight,
        },
      );
      const errno = error as NodeJS.ErrnoException;
      this.reportProcessLifecycle((reporter) =>
        reporter.onError?.({
          pid: typeof child.pid === "number" ? child.pid : null,
          provider: CF_AGENT_PROVIDER,
          ...(this.lane ? { lane: this.lane } : {}),
          workspacePath: params.workspacePath,
          command: effectiveCommand.command,
          args: effectiveCommand.args ?? [],
          errorName: error.name || "Error",
          ...(typeof errno.code === "string" ? { errorCode: errno.code } : {}),
          errorMessage: error.message,
          ...(error.stack ? { errorStack: error.stack } : {}),
          runtimeGeneration,
          runtimeInstanceId,
          occurredAt: Date.now(),
        }),
      );
      if (child.pid == null) {
        exitDiagnostics.resolve();
        this.ownedProcesses.delete(managed);
      }
    });
    child.once("exit", async (code, signal) => {
      try {
        managed.exited = true;
        this.clearIdleTimer(managed);
        const endedAt = Date.now();
        const terminationKind = managed.terminationIntent?.kind ?? "unexpected";
        const terminationReason = managed.terminationIntent?.reason ?? managed.firstCleanupReason;
        await transport.waitForStderrDrain();
        const stderr = stderrTail.snapshot();
        const exitContext = {
          workspaceKey,
          pid: child.pid,
          runtimeIdentity: runtimeIdentity.identity,
          code,
          signal,
          terminationKind,
          terminationReason,
        };
        log("CodeFusion agent process exited", exitContext);
        if (terminationKind === "unexpected") {
          errorLog(
            `CodeFusion agent process exited unexpectedly${this.processLifecycleReporter ? ` ${CF_AGENT_LIFECYCLE_LOG_MARKER}` : ""}`,
            {
              ...exitContext,
              stderr,
            },
          );
        }
        if (typeof child.pid === "number") {
          this.reportProcessLifecycle((reporter) =>
            reporter.onExit({
              pid: child.pid!,
              provider: CF_AGENT_PROVIDER,
              ...(this.lane ? { lane: this.lane } : {}),
              workspacePath: params.workspacePath,
              exitCode: code,
              signal,
              endedAt,
              terminationKind,
              runtimeReady: managed.readyAt != null,
              ...(terminationReason ? { terminationReason } : {}),
              runtimeGeneration,
              runtimeInstanceId,
              uptimeMs: Math.max(0, endedAt - startedAt),
              stderrLineCount: stderr.lineCount,
              ...(terminationKind === "unexpected" && stderr.tail.length > 0
                ? { stderrTail: stderr.tail }
                : {}),
            }),
          );
        }
      } finally {
        exitDiagnostics.resolve();
      }
    });
    client.onRequestTimeout((event) => {
      if (this.processesByWorkspaceKey.get(workspaceKey) !== managed) {
        return;
      }
      if (event.method === "workspace/cancelGenerateText") {
        warnLog(
          "CodeFusion agent cancel notification timed out; keeping client (best-effort control plane)",
          {
            workspaceKey,
            method: event.method,
            requestId: event.requestId,
            timeoutMs: event.timeoutMs,
            pid: child.pid,
          },
        );
        return;
      }
      warnLog("CodeFusion agent request timed out; disposing stale protocol client", {
        workspaceKey,
        method: event.method,
        requestId: event.requestId,
        timeoutMs: event.timeoutMs,
        pid: child.pid,
      });
      this.processesByWorkspaceKey.delete(workspaceKey);
      this.reportRuntimeUnavailable(managed);
      void this.cleanupManagedProcessWithRetry(
        managed,
        "request-timeout",
        "request-timeout",
        "request timeout",
      ).catch(() => undefined);
    });
    client.onClose(() => {
      const wasActiveClient = this.processesByWorkspaceKey.get(workspaceKey) === managed;
      log("CodeFusion agent protocol client closed", {
        workspaceKey,
        pid: child.pid,
        runtimeIdentity: runtimeIdentity.identity,
        wasActiveClient,
      });
      if (wasActiveClient) {
        this.processesByWorkspaceKey.delete(workspaceKey);
      }
      this.reportRuntimeUnavailable(managed);
      if (this.ownedProcesses.has(managed)) {
        void this.cleanupManagedProcessWithRetry(
          managed,
          "protocol-close",
          "protocol-close",
          "protocol close",
        ).catch(() => undefined);
      }
    });
    return client;
  }

  async getRuntimeIdentity(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<CfAgentRuntimeIdentity> {
    const workspaceKey = resolveWorkspaceKey(params);
    const managed = this.processesByWorkspaceKey.get(workspaceKey);
    if (!managed || managed.exited || managed.child.killed) {
      throw new Error("CodeFusion agent runtime identity is unavailable.");
    }
    return managed.runtimeIdentity;
  }

  async canStart(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<{ available: boolean; workspaceKey: string; reason?: string }> {
    const workspaceKey = resolveWorkspaceKey(params);
    try {
      const command = await this.commandResolver({
        ...params,
        ...(this.presentationSurface ? { presentationSurface: this.presentationSurface } : {}),
        workspaceKey,
      });
      return command
        ? { available: true, workspaceKey }
        : {
            available: false,
            workspaceKey,
            reason: "CF_AGENT_SERVER_COMMAND is not configured",
          };
    } catch (error) {
      return {
        available: false,
        workspaceKey,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async disposeWorkspace(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<void> {
    const workspaceKey = resolveWorkspaceKey(params);
    this.restartGenerationByWorkspaceKey.set(
      workspaceKey,
      (this.restartGenerationByWorkspaceKey.get(workspaceKey) ?? 0) + 1,
    );
    this.abortPendingStarts(workspaceKey);
    const managed = this.processesByWorkspaceKey.get(workspaceKey);
    this.processesByWorkspaceKey.delete(workspaceKey);
    if (managed) {
      this.reportRuntimeUnavailable(managed);
      await this.cleanupManagedProcessWithRetry(
        managed,
        "workspace-dispose",
        "workspace-dispose-retry",
        "workspace dispose",
      );
    }
  }

  private abortPendingStarts(
    workspaceKey: string,
    reason = new Error("CodeFusion agent process start was cancelled."),
  ): void {
    const controllers = this.startAdmissionAbortControllersByWorkspaceKey.get(workspaceKey);
    if (!controllers) {
      return;
    }
    for (const controller of controllers) {
      controller.abort(reason);
    }
  }

  private abortAllPendingStarts(
    reason = new Error("CodeFusion agent process manager is disposed."),
  ): void {
    for (const workspaceKey of this.startAdmissionAbortControllersByWorkspaceKey.keys()) {
      this.abortPendingStarts(workspaceKey, reason);
    }
  }

  disposeAll(): void {
    this.disposed = true;
    this.storageStartupEmitter.dispose();
    this.abortAllPendingStarts();
    for (const managed of this.ownedProcesses) {
      this.recordTerminationIntent(managed, "manager-dispose");
      this.reportRuntimeUnavailable(managed);
      managed.client.dispose();
    }
    this.processesByWorkspaceKey.clear();
    this.startingByWorkspaceKey.clear();
  }

  async disposeAllAndWait(): Promise<void> {
    if (this.disposeAllInFlight) {
      return this.disposeAllInFlight;
    }
    this.disposed = true;
    this.storageStartupEmitter.dispose();
    this.abortAllPendingStarts();

    const managedProcesses = [...this.ownedProcesses];
    for (const managed of managedProcesses) {
      this.reportRuntimeUnavailable(managed);
    }
    this.processesByWorkspaceKey.clear();
    this.startingByWorkspaceKey.clear();

    this.disposeAllInFlight = Promise.all(
      managedProcesses.map((managed) => this.cleanupManagedProcessForShutdown(managed)),
    ).then(() => undefined);
    try {
      await this.disposeAllInFlight;
    } finally {
      this.disposeAllInFlight = undefined;
    }
  }
}
