
import { fork } from "node:child_process";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { isPublicCfErrorCode, CF_VERSION } from "@origin-ai/cf-shared";
import { SourceServerWorkspaceAliasRepo } from "@origin-ai/cf-services/node";
import {
  CORE_KILL_TIMEOUT_MS,
  CORE_READY_TIMEOUT_MS,
  CORE_STOP_GRACE_TIMEOUT_MS,
  controlRequestSchema,
  createStoppedServerStatus,
  serverStatusSchema,
  type ServerStatus,
} from "./contracts.js";
import { requestControl } from "./ipc/controlClient.js";
import {
  resolveCanonicalServerLayout,
  resolveServerLayout,
  validateUninstallTarget,
} from "./runtime/paths.js";
import { validateServerInstallOwnership } from "./runtime/installationOwnership.js";
import { createReleaseAgentWiring, type BundledAgentWiring } from "./runtime/agentWiring.js";
import { writeStableLauncher } from "./runtime/stableLauncher.js";
import {
  runLocalArchiveUpdateCommand,
  runUpdateCommand,
  type UpdateDaemonHandoff,
} from "./runtime/updateCommand.js";
import { DataRootLock } from "./runtime/lock.js";
import { ReleaseManager } from "./runtime/releaseManager.js";
import { createUpdateDaemonHandoff } from "./runtime/updateHandoff.js";
import {
  acquireUninstallLock,
  describeLockInspection,
  removeRunContentsExceptLock,
} from "./runtime/uninstallGuard.js";
import { readPersistedStatus, readPersistedStatusDetailed } from "./runtime/statusSnapshot.js";
import { waitForServerStopped } from "./runtime/shutdownWait.js";
export { readPersistedStatus } from "./runtime/statusSnapshot.js";
import {
  hasLegacyServiceRegistration,
  unregisterInstalledService,
  unregisterLegacyServiceForRoot,
} from "./runtime/serviceInstallation.js";
import { ProxyStdioError, runProxyStdio } from "./server-core/proxyStdio.js";

export interface CliIO {
  stdout?: { write(value: string): void };
  stderr?: { write(value: string): void };
  confirm?: (prompt: string) => Promise<string>;
  legacyDelegate?: (argv: readonly string[]) => Promise<number>;
}

export interface ServerCliRuntimeOptions {
  bundledAgentWiring?: BundledAgentWiring | null;
  proxyStdioStreams?: { input: Readable; output: Writable };
  workspaceAliasRepo?: Pick<SourceServerWorkspaceAliasRepo, "retryFailedWorkspace">;
  
  updateDaemonHandoff?: UpdateDaemonHandoff;
}

const stdout = (io: CliIO, value: unknown): void =>
  io.stdout?.write(`${typeof value === "string" ? value : JSON.stringify(value)}\n`);
const stderr = (io: CliIO, value: unknown): void =>
  io.stderr?.write(`${value instanceof Error ? value.message : String(value)}\n`);

async function acquireLifecycleCommandLock(
  layout: ReturnType<typeof resolveServerLayout>,
  conflictMessage: string,
): Promise<DataRootLock> {
  const lock = new DataRootLock(layout.updateLockFile);
  try {
    await lock.acquire();
    return lock;
  } catch (error) {
    if (error instanceof Error && error.message.includes("already running")) {
      throw new Error(conflictMessage, { cause: error });
    }
    throw error;
  }
}

export function serviceRegistrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CF_SERVER_SKIP_SERVICE_REGISTRATION !== "1";
}

export function daemonStartupMode(env: NodeJS.ProcessEnv = process.env): "service" | "fallback" {
  return serviceRegistrationEnabled(env) ? "service" : "fallback";
}

export function isRegisteredServiceEntry(args: readonly string[]): boolean {
  return args.includes("--service-entry");
}

export const SERVER_SERVICE_ARGS = ["serve", "--supervisor"] as const;

export function shouldRegisterService(
  daemonRequested: boolean,
  supervisorProcess: boolean,
): boolean {
  return daemonRequested && !supervisorProcess;
}

export async function runServerCli(
  argv: readonly string[],
  io: CliIO = {},
  runtimeOptions: ServerCliRuntimeOptions = {},
): Promise<number> {
  const json = argv.includes("--json");
  try {
    const parsed = parseServerCliArguments(argv);
    const command = parsed.argv[0];
    if (command === "version" || command === "--version") {
      stdout(io, json ? { product: "cf-server", version: CF_VERSION } : CF_VERSION);
      return 0;
    }
    const proxyStdioRequested =
      command === "proxy-stdio" || (command === "server" && parsed.argv[1] === "proxy-stdio");
    const migrateRetryRequested = command === "migrate" && parsed.argv[1] === "retry";
    if (!command) {
      return await (io.legacyDelegate?.(parsed.argv) ?? delegateLegacyCli(parsed.argv, io));
    }
    const layout =
      ["serve", "status", "stop", "restart", "update", "uninstall"].includes(command) ||
      proxyStdioRequested ||
      migrateRetryRequested
        ? await resolveCanonicalServerLayout(parsed.layout.serverRoot)
        : parsed.layout;
    if (proxyStdioRequested) {
      try {
        await runProxyStdio({
          layout,
          input: runtimeOptions.proxyStdioStreams?.input ?? process.stdin,
          output: runtimeOptions.proxyStdioStreams?.output ?? process.stdout,
        });
        return 0;
      } catch (error) {
        const code = error instanceof ProxyStdioError ? error.code : "proxy-stdio-failed";
        io.stderr?.write(
          `${JSON.stringify({ ok: false, code, error: error instanceof Error ? error.message : String(error) })}\n`,
        );
        return 1;
      }
    }
    if (migrateRetryRequested) {
      const pathIndex = parsed.argv.indexOf("--path");
      const workspacePath = pathIndex >= 0 ? parsed.argv[pathIndex + 1] : undefined;
      if (!workspacePath) throw new Error("migrate retry requires --path");
      if (!isAbsolute(workspacePath)) throw new Error("migrate retry --path must be absolute");
      const result = await (
        runtimeOptions.workspaceAliasRepo ?? new SourceServerWorkspaceAliasRepo()
      ).retryFailedWorkspace(workspacePath);
      stdout(io, json ? { ok: true, ...result } : `Migration recovered: ${result.canonicalKey}`);
      return 0;
    }
    switch (command) {
      case "serve":
        return await runServe(parsed.argv.slice(1), io, json, layout, runtimeOptions);
      case "status":
      case "running-tasks":
      case "stop":
      case "restart":
        return await runControl(command, io, json, {}, layout);
      case "update": {
        const updateLock = await acquireLifecycleCommandLock(
          layout,
          "Another CodeFusion Server update is already running",
        );
        const updateDaemonHandoff =
          runtimeOptions.updateDaemonHandoff ?? createUpdateDaemonHandoff();
        try {
          if (parsed.argv.includes("--from-archive")) {
            return await runLocalArchiveUpdateCommand(
              parsed.argv,
              io,
              json,
              layout,
              () => requestApplyUpdate(layout, parsed.argv.includes("--force")),
              updateDaemonHandoff,
            );
          }
          return await runUpdateCommand(
            parsed.argv,
            io,
            json,
            layout,
            () => requestApplyUpdate(layout, parsed.argv.includes("--force")),
            updateDaemonHandoff,
          );
        } finally {
          await updateLock.release();
        }
      }
      case "uninstall": {
        const uninstallLock = await acquireLifecycleCommandLock(
          layout,
          "A CodeFusion Server update is already running",
        );
        try {
          return await runUninstall(io, json, layout);
        } finally {
          await uninstallLock.release();
        }
      }
      default:
        return await (io.legacyDelegate?.(parsed.argv) ?? delegateLegacyCli(parsed.argv, io));
    }
  } catch (error: unknown) {
    if (json) {
      const structured =
        error && typeof error === "object"
          ? (error as { code?: unknown; retryable?: unknown })
          : null;
      const publicCode = isPublicCfErrorCode(structured?.code) ? structured.code : undefined;
      stdout(io, {
        ok: false,
        ...(publicCode ? { code: publicCode } : {}),
        ...(publicCode && typeof structured?.retryable === "boolean"
          ? { retryable: structured.retryable }
          : {}),
        error: error instanceof Error ? error.message : String(error),
      });
    } else stderr(io, error);
    return 1;
  }
}

function parseServerCliArguments(argv: readonly string[]): {
  argv: readonly string[];
  layout: ReturnType<typeof resolveServerLayout>;
} {
  const rootOptionIndexes = argv.flatMap((value, index) =>
    value === "--server-root" ? [index] : [],
  );
  if (rootOptionIndexes.length > 1) throw new Error("--server-root may only be specified once");
  const rootOptionIndex = rootOptionIndexes[0];
  if (rootOptionIndex === undefined) return { argv, layout: resolveServerLayout() };
  const serverRoot = argv[rootOptionIndex + 1];
  if (!serverRoot) throw new Error("--server-root requires an absolute path");
  if (!isAbsolute(serverRoot)) throw new Error("--server-root must be an absolute path");
  return {
    argv: argv.filter(
      (_value, index) => index !== rootOptionIndex && index !== rootOptionIndex + 1,
    ),
    layout: resolveServerLayout(serverRoot),
  };
}

async function runServe(
  args: readonly string[],
  io: CliIO,
  json: boolean,
  layout: ReturnType<typeof resolveServerLayout>,
  runtimeOptions: ServerCliRuntimeOptions,
): Promise<number> {
  const daemonRequested = args.includes("--daemon");
  const supervisorProcess = args.includes("--supervisor");
  if (shouldRegisterService(daemonRequested, supervisorProcess)) {
    let startupMode = daemonStartupMode();
    const platform =
      process.platform === "darwin" || process.platform === "linux" ? process.platform : "win32";
    if (startupMode === "service") {
      const { isServiceManagerAvailable } = await import("./platform/serviceManager.js");
      if (!(await isServiceManagerAvailable(platform))) {
        startupMode = "fallback";
      }
    }
    const legacyIdentityMigration =
      startupMode === "service" && (await hasLegacyServiceRegistration(layout));
    const existing = await readControlStatus(layout, 500);
    if (existing && (existing.state === "ready" || existing.state === "starting")) {
      if ((existing.serviceRegistered && !legacyIdentityMigration) || startupMode === "fallback") {
        if (json) stdout(io, existing);
        else
          stdout(
            io,
            `CodeFusion Server ${existing.state} at ${existing.host ?? ""}:${existing.port ?? ""}`,
          );
        return 0;
      }
      if (existing.runningTaskCount > 0) {
        throw new Error(
          `Cannot replace fallback daemon while ${existing.runningTaskCount} task(s) are running; stop the server first`,
        );
      }
      await stopExistingSupervisor(layout, "Cannot verify fallback Server status before migration");
    } else if (existing?.state === "stop-failed" && existing.pid === null) {
      await stopExistingSupervisor(
        layout,
        "Cannot verify stop-failed Server status before restart",
      );
    }
    const baselineUpdatedAt = (await readPersistedStatus(layout))?.updatedAt ?? 0;
    let serviceStarted = false;
    let childEarlyExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    if (startupMode === "service") {
      const { createDaemonServiceDescriptor, registerService, serviceDescriptorPath } =
        await import("./platform/serviceManager.js");
      await writeStableLauncher(layout, platform, {
        command: process.execPath,
        entry: process.argv[1] ?? fileURLToPath(import.meta.url),
      });
      const descriptor = createDaemonServiceDescriptor({ platform, layout });
      await mkdir(layout.serviceDir, { recursive: true, mode: 0o700 });
      const descriptorPath = serviceDescriptorPath(layout, descriptor);
      await writeFile(descriptorPath, descriptor.content, "utf8");
      await unregisterLegacyServiceForRoot(layout);
      await registerService(descriptor, descriptorPath);
      serviceStarted = true;
    }
    if (!serviceStarted) {
      const supervisorEntry = process.argv[1] ?? fileURLToPath(import.meta.url);
      const child = fork(
        supervisorEntry,
        [...SERVER_SERVICE_ARGS, "--server-root", layout.serverRoot],
        {
          detached: true,
          stdio: "ignore",
          env: {
            ...process.env,
            CF_DATA_BASE_DIR: layout.dataBaseDir,
            CF_SERVER_ROOT: layout.serverRoot,
          },
        },
      );
      child.unref();
      child.disconnect();
      child.once("exit", (code, signal) => {
        childEarlyExit = { code, signal };
      });
    }
    const started = await waitForPersistedStatus(
      layout,
      "ready",
      baselineUpdatedAt,
      () => {
        if (childEarlyExit) {
          throw new Error(
            `CodeFusion Server daemon exited before ready (code=${childEarlyExit.code ?? "null"} signal=${childEarlyExit.signal ?? "none"}); check ${layout.statusFile} for details`,
          );
        }
      },
      serviceStarted,
    );
    if (json) stdout(io, started);
    else stdout(io, `CodeFusion Server ${started.state} at ${started.host ?? ""}:${started.port ?? ""}`);
    process.stdin.pause();
    process.stdin.destroy();
    return 0;
  }
  const daemon = supervisorProcess;
  const { Supervisor } = await import("./supervisor/supervisor.js");
  const serviceRegistered = supervisorProcess && isRegisteredServiceEntry(args);
  const executingRelease = await new ReleaseManager(layout).readCurrent();
  const executingEntry = process.argv[1] ?? fileURLToPath(import.meta.url);
  const executingReleaseDir = dirname(dirname(resolve(executingEntry)));
  const supervisorReleaseId =
    executingRelease?.releaseId &&
    resolve(executingRelease.releaseDir) === resolve(executingReleaseDir)
      ? executingRelease.releaseId
      : undefined;
  let foregroundStopped: (() => void) | undefined;
  const supervisor = new Supervisor({
    layout,
    launcher: {
      launch: (generation, release) => {
        const runtimeRoot = release?.releaseDir ? join(release.releaseDir, "runtime") : null;
        const corePath = runtimeRoot
          ? join(runtimeRoot, "server-core.js")
          : fileURLToPath(new URL("./server-core.js", import.meta.url));
        const runtimeNode = runtimeRoot
          ? join(runtimeRoot, process.platform === "win32" ? "node.exe" : "node")
          : process.execPath;
        const inheritedEnv = {
          ...process.env,
          CF_DATA_BASE_DIR: layout.dataBaseDir,
          CF_SERVER_ROOT: layout.serverRoot,
        };
        const releaseWiring = runtimeRoot
          ? createReleaseAgentWiring(runtimeRoot, runtimeNode, inheritedEnv)
          : runtimeOptions.bundledAgentWiring;
        return fork(corePath, [String(generation)], {
          execPath: runtimeNode,
          env: {
            ...inheritedEnv,
            ...releaseWiring,
            ...(runtimeRoot ? { CF_SERVER_RUNTIME_ROOT: runtimeRoot } : {}),
            ...(release?.releaseId ? { CF_SERVER_RELEASE_ID: release.releaseId } : {}),
          },
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
      },
    },
    version: CF_VERSION,
    ...(supervisorReleaseId ? { supervisorReleaseId } : {}),
    serviceRegistered,
    onStopped: () => {
      process.stdin.pause();
      foregroundStopped?.();
      if (supervisorProcess) process.disconnect?.();
    },
  });
  await supervisor.start();
  let status: ServerStatus;
  try {
    status = await waitForSupervisorReady(supervisor);
  } catch (error) {
    await supervisor.stop("startup-failed").catch(() => undefined);
    throw error;
  }
  if (json) stdout(io, status);
  else stdout(io, `CodeFusion Server ${status.state} at ${status.host ?? ""}:${status.port ?? ""}`);
  await new Promise<void>((resolve) => {
    foregroundStopped = resolve;
    if (!daemon) {
      const finish = () => {
        void supervisor.stop("signal").then(() => resolve());
      };
      process.once("SIGINT", finish);
      process.once("SIGTERM", finish);
    }
  });
  return 0;
}

export const APPLY_UPDATE_TIMEOUT_MS =
  3 * (CORE_STOP_GRACE_TIMEOUT_MS + CORE_KILL_TIMEOUT_MS) + 2 * CORE_READY_TIMEOUT_MS + 30_000;

async function stopExistingSupervisor(
  layout: ReturnType<typeof resolveServerLayout>,
  unverifiedStatusMessage: string,
): Promise<void> {
  const persistedBeforeStop = await readPersistedStatusDetailed(layout);
  if (persistedBeforeStop.state === "invalid" || persistedBeforeStop.state === "unreadable") {
    throw new Error(unverifiedStatusMessage);
  }
  const stopBaselineUpdatedAt = persistedBeforeStop.status?.updatedAt ?? 0;
  await requestControl(layout.controlEndpoint, { command: "stop" });
  await waitForServerStopped(layout, stopBaselineUpdatedAt, true);
}

async function requestApplyUpdate(
  layout: ReturnType<typeof resolveServerLayout>,
  force: boolean,
): Promise<unknown> {
  return await requestControl(
    layout.controlEndpoint,
    { command: "apply-update", ...(force ? { force: true } : {}) },
    APPLY_UPDATE_TIMEOUT_MS,
  );
}

async function runControl(
  command: string,
  io: CliIO,
  json: boolean,
  extra: Record<string, unknown> = {},
  layout = resolveServerLayout(),
): Promise<number> {
  const request = controlRequestSchema.parse({ id: "cli", command, ...extra });
  let result: unknown;
  try {
    result = await requestControl(
      layout.controlEndpoint,
      request,
      command === "apply-update" ? APPLY_UPDATE_TIMEOUT_MS : undefined,
    );
  } catch (error: unknown) {
    if (command === "status") {
      const persisted = await readPersistedStatusDetailed(layout);
      result = persisted.status ?? createStoppedServerStatus(CF_VERSION);
    } else if (command === "stop" && isControlEndpointUnavailable(error)) {
      const persisted = await readPersistedStatusDetailed(layout);
      if (persisted.state === "invalid" || persisted.state === "unreadable") {
        throw error;
      }
      if (
        persisted.status &&
        persisted.status.state !== "stopped" &&
        persisted.status.state !== "uninstalled"
      ) {
        throw error;
      }
      result = persisted.status ?? createStoppedServerStatus(CF_VERSION);
    } else {
      throw error;
    }
  }
  if (json) stdout(io, result);
  else stdout(io, result ?? "ok");
  return 0;
}

function isControlEndpointUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ECONNREFUSED" || error.code === "EINVAL";
}

async function runUninstall(
  io: CliIO,
  json: boolean,
  layout: ReturnType<typeof resolveServerLayout>,
): Promise<number> {
  const first = await (io.confirm?.("Type DELETE to uninstall CodeFusion Server: ") ??
    Promise.resolve(""));
  if (first !== "DELETE") throw new Error("Uninstall cancelled");
  const second = await (io.confirm?.("Type DELETE again to confirm: ") ?? Promise.resolve(""));
  if (second !== "DELETE") throw new Error("Uninstall cancelled");
  const ownership = await validateServerInstallOwnership(layout);
  try {
    await runControl("confirm-uninstall", io, json, { confirmation: "DELETE" }, layout);
  } catch (error: unknown) {
    const persisted = await readPersistedStatusDetailed(layout);
    if (persisted.status?.state === "stopped" || persisted.status?.state === "uninstalled")
      return await finishUninstall(io, json, layout, ownership);
    const lockInspection = await new DataRootLock(layout.lockFile).inspect();
    if (lockInspection.state === "active") {
      throw new Error(`Cannot uninstall while Server lock is held by pid ${lockInspection.pid}`, {
        cause: error,
      });
    }
    if (lockInspection.state === "invalid" || lockInspection.state === "unreadable") {
      throw new Error(
        `Cannot verify Server shutdown before uninstall (${describeLockInspection(lockInspection)})`,
        { cause: error },
      );
    }
  }
  await waitForServerStopped(layout);
  return await finishUninstall(io, json, layout, ownership);
}

async function finishUninstall(
  io: CliIO,
  json: boolean,
  layout: ReturnType<typeof resolveServerLayout>,
  ownership: Awaited<ReturnType<typeof validateServerInstallOwnership>>,
): Promise<number> {
  await unregisterInstalledService(layout);
  const uninstallLock = await acquireUninstallLock(layout);
  const uninstallEntries = [
    "releases",
    "run",
    "cache",
    "bin",
    "service",
    "current.json",
    "pending.json",
    "uninstalled.json",
    "update-transaction.json",
    "node",
    "cf-server.cjs",
    "agents",
    "build",
    "tools",
  ] as const;
  try {
    for (const entry of uninstallEntries) {
      const target = validateUninstallTarget(
        ownership.canonicalServerRoot,
        join(ownership.canonicalServerRoot, entry),
      );
      if (!target.ok || !target.canonicalPath) {
        throw new Error(`Unsafe uninstall target: ${target.reason ?? "unknown"}`);
      }
      if (entry === "run") {
        await removeRunContentsExceptLock(layout);
      } else {
        await rm(target.canonicalPath, { recursive: true, force: true });
      }
    }
    const preservedPaths = (await readdir(ownership.canonicalServerRoot))
      .filter((entry) => entry !== "run")
      .sort();
    await writeFile(
      layout.uninstalledFile,
      `${JSON.stringify({ uninstalled: true, uninstalledAt: Date.now(), version: CF_VERSION, preservedPaths }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await uninstallLock.release();
    await rm(layout.runDir, { recursive: true, force: true });
    if (json) stdout(io, { uninstalled: true, preservedPaths });
    else stdout(io, "uninstalled");
    return 0;
  } catch (error: unknown) {
    await uninstallLock.release().catch(() => undefined);
    throw error;
  }
}

async function waitForPersistedStatus(
  layout: ReturnType<typeof resolveServerLayout>,
  expectedState: "ready" | "stopped",
  minUpdatedAt = 0,
  assertStillWaiting?: () => void,
  expectedServiceRegistered?: boolean,
): Promise<ServerStatus> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const status = await readPersistedStatus(layout);
    if (
      status?.state === expectedState &&
      status.updatedAt > minUpdatedAt &&
      (expectedServiceRegistered === undefined ||
        status.serviceRegistered === expectedServiceRegistered)
    )
      return status;
    assertStillWaiting?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Server ${expectedState}`);
}

async function waitForSupervisorReady(supervisor: {
  status: () => ServerStatus;
}): Promise<ServerStatus> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const status = supervisor.status();
    if (status.state === "ready") return status;
    if (status.state === "crash-loop-stopped")
      throw new Error("Server Core entered crash-loop-stopped");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for Server Core ready");
}

async function readControlStatus(
  layout: ReturnType<typeof resolveServerLayout>,
  timeoutMs: number,
): Promise<ServerStatus | null> {
  try {
    const result = await requestControl(layout.controlEndpoint, { command: "status" }, timeoutMs);
    return serverStatusSchema.parse(result);
  } catch {
    return null;
  }
}

async function delegateLegacyCli(argv: readonly string[], io: CliIO): Promise<number> {
  const candidate =
    process.env.CF_LEGACY_CLI_ENTRY?.trim() ||
    join(dirname(fileURLToPath(import.meta.url)), "cf.cjs");
  try {
    await access(candidate);
  } catch {
    stdout(io, argv.length ? `Unknown command: ${argv[0]}` : "CodeFusion TUI");
    return argv.length ? 1 : 0;
  }
  const child = fork(candidate, [...argv], { stdio: "inherit" });
  return await new Promise<number>((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
}
