import { sourceServerRunningTasksSchema, type SourceServerRunningTask } from "@origin-ai/cf-shared";

import { SourceServerOperationLogs } from "./sourceServerOperationLogs.js";
import { Emitter, type Event } from "@origin-ai/cf-rpc";
import type {
  ConnectionProfile,
  RemoteTarget,
  ServerRemoteInfo,
  CompatibilityManifest,
  SourceServerArtifactPolicy,
  SourceServerConnectionStateSnapshot,
} from "@origin-ai/cf-shared";
import {
  SOURCE_SERVER_INSTALL_REQUIRED_ERROR_CODE,
  SOURCE_SERVER_IDENTITY_CHANGE_PENDING_ERROR_CODE,
  SOURCE_SERVER_UPGRADE_REQUIRED_ERROR_CODE,
  REMOTE_RECOVERY_BUDGET_EXHAUSTED_ERROR_CODE,
  CF_COMPATIBILITY_MANIFEST,
  compareCompatibilityVersions,
  evaluateSourceServerCompatibility,
  isPublicCfErrorCode,
  normalizeRemoteConnectionError,
  stripRemoteTargetSecrets,
} from "@origin-ai/cf-shared";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import {
  createSourceServerTransportAdapter,
  type ServerReleaseAsset,
  type SourceServerFileTransfer,
  type SourceServerTransportAdapter,
  type TransportContext,
} from "@origin-ai/cf-server/source-server";
import {
  connectServerRemoteOverDuplex,
  type ServerRemoteConnection,
  type ServerRemoteDuplexConnectionOptions,
} from "./serverRemoteConnection.js";
import type { SourceServerDirectory } from "./sourceServerDirectory.js";
import { isSourceServerAutomaticRecoveryTerminalState } from "./sourceServerRecoveryPolicy.js";

export type {
  SourceServerConnectionState,
  SourceServerConnectionStateSnapshot,
} from "@origin-ai/cf-shared";

export interface ManagedSourceServerConnection {
  
  reusedConnectionTarget?: RemoteTarget;
  sourceServerId: string;
  profileId: string;
  serverInfo: ServerRemoteInfo;
  services: IServiceAccessor;
}

export type SourceServerConnectionInvalidatedEvent =
  | {
      sourceServerId: string;
      reason: "update";
    }
  | {
      sourceServerId: string;
      reason: "profile-removed";
      recoverable: false;
    };

export class SourceServerInstallRequiredError extends Error {
  public readonly code = SOURCE_SERVER_INSTALL_REQUIRED_ERROR_CODE;
  public readonly retryable = false;
  public constructor(public readonly profileId: string) {
    super("Source Server installation requires explicit user confirmation");
    this.name = "SourceServerInstallRequiredError";
  }
}

export class SourceServerUpgradeRequiredError extends Error {
  public readonly code = SOURCE_SERVER_UPGRADE_REQUIRED_ERROR_CODE;
  public readonly retryable = false;
  public constructor(
    public readonly profileId: string,
    public readonly upgradeTarget: "controller" | "server",
    public readonly currentVersion: string,
    public readonly minimumVersion: string,
    public readonly reason: "compatibility" | "development-archive" = "compatibility",
  ) {
    super(
      reason === "development-archive"
        ? `Source Server ${currentVersion} release archive differs from the current development build and must be updated`
        : upgradeTarget === "server"
          ? `Source Server ${currentVersion} must be upgraded to at least ${minimumVersion}`
          : `CodeFusion Desktop ${currentVersion} must be upgraded to at least ${minimumVersion}`,
    );
    this.name = "SourceServerUpgradeRequiredError";
  }
}

export class SourceServerIdentityChangePendingError extends Error {
  public readonly code = SOURCE_SERVER_IDENTITY_CHANGE_PENDING_ERROR_CODE;
  public readonly retryable = false;
  public constructor(
    public readonly profileId: string,
    public readonly pendingSourceServerId: string,
  ) {
    super("Source Server identity changed after reinstall and requires confirmation");
    this.name = "SourceServerIdentityChangePendingError";
  }
}

class SourceServerExplicitDisconnectError extends Error {
  public readonly code = "remote-connection-canceled";
  public constructor(public readonly sourceServerId: string) {
    super(`Source Server explicitly disconnected: ${sourceServerId}`);
    this.name = "SourceServerExplicitDisconnectError";
  }
}

class SourceServerProfileRemovedError extends Error {
  public constructor(public readonly profileId: string) {
    super(`Connection Profile removed: ${profileId}`);
    this.name = "SourceServerProfileRemovedError";
  }
}

class SourceServerHandshakeClosedError extends Error {
  public readonly retryable = true;
  public constructor(reason: string) {
    super(`Source Server connection closed during handshake: ${reason}`);
    this.name = "SourceServerHandshakeClosedError";
  }
}

export interface SourceServerConnectionManagerOptions {
  
  admitConnection?: (input: {
    profile: ConnectionProfile;
    intent: "add" | "retain";
    confirmIdentityChange: boolean;
  }) => Promise<(sourceServerId: string) => Promise<void>>;
  directory: {
    recordLastOnline?(sourceServerId: string, timestamp: number): Promise<void>;
    markSourceUninstalled?(profileId: string): Promise<void>;
    recordHandshake(
      profileId: string,
      handshake: Parameters<SourceServerDirectory["recordHandshake"]>[1],
      options?: Parameters<SourceServerDirectory["recordHandshake"]>[2],
    ): Promise<{
      identityChanged: boolean;
      effectiveProfile?: ConnectionProfile;
    }>;
  };
  createAdapter?: (kind: "ssh" | "wsl" | "docker") => SourceServerTransportAdapter;
  connectServer?: (options: ServerRemoteDuplexConnectionOptions) => Promise<ServerRemoteConnection>;
  now?: () => number;
  logWarn?: (message: string, error: Error) => void;
  onProjectChange?: (sourceServerId: string) => void;
  compatibilityManifest?: CompatibilityManifest;
  sourceServerArtifactPolicy?: SourceServerArtifactPolicy;
  resolveRelease?: (
    probe: Awaited<ReturnType<SourceServerTransportAdapter["probe"]>>,
    target: Exclude<RemoteTarget, { kind: "server" }>,
    options?: { metadataOnly?: boolean },
  ) => Promise<ServerReleaseAsset>;
}

export interface ConnectSourceServerOptions {
  membershipIntent?: "add" | "retain";
  profile: ConnectionProfile;
  target: RemoteTarget;
  release?: ServerReleaseAsset;
  allowInstall?: boolean;
  confirmIdentityChange?: boolean;
  resolveRelease?: SourceServerConnectionManagerOptions["resolveRelease"];
  context?: TransportContext;
  onDiagnosticPhase?: (phase: string) => void;
  
  onAuthenticatedUpgradeRequired?: () => Promise<void>;
}

export interface StartupReconnectResult {
  profileId: string;
  status: "online" | "failed";
  error?: string;
}

interface OnlineConnection extends ManagedSourceServerConnection {
  connection: ServerRemoteConnection;
  profileIds: Set<string>;
  projectSubscription?: { dispose(): void };
}

interface ReconnectInput {
  profile: ConnectionProfile;
  target: Exclude<RemoteTarget, { kind: "server" }>;
  context: TransportContext;
}

interface ConnectFlight {
  promise: Promise<ManagedSourceServerConnection>;
  sourceServerId?: string;
  controller: AbortController;
}

const ONLINE_RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;
const OFFLINE_PROBE_INTERVAL_MS = 2 * 60_000;

function readErrorRetryable(error: unknown): boolean | undefined {
  if (!error || typeof error !== "object" || !("retryable" in error)) {
    return undefined;
  }
  return typeof error.retryable === "boolean" ? error.retryable : undefined;
}

function isAutomaticRecoveryUserActionCode(code: unknown): boolean {
  return (
    code === SOURCE_SERVER_INSTALL_REQUIRED_ERROR_CODE ||
    code === SOURCE_SERVER_UPGRADE_REQUIRED_ERROR_CODE ||
    code === SOURCE_SERVER_IDENTITY_CHANGE_PENDING_ERROR_CODE
  );
}

function buildCompatibilityState(
  controller: CompatibilityManifest,
  server: CompatibilityManifest,
): Pick<
  SourceServerConnectionStateSnapshot,
  "updateAvailability" | "currentVersion" | "availableVersion" | "minimumVersion" | "upgradeTarget"
> {
  const result = evaluateSourceServerCompatibility(controller, server);
  if (!result.compatible && result.upgradeTarget) {
    return {
      updateAvailability: "required",
      currentVersion: result.olderVersion,
      availableVersion: result.newerVersion,
      minimumVersion: result.requiredMinimumVersion,
      upgradeTarget: result.upgradeTarget,
    };
  }
  if (result.updateAvailable) {
    return {
      updateAvailability: "available",
      currentVersion: result.olderVersion,
      availableVersion: result.newerVersion,
      minimumVersion: result.requiredMinimumVersion,
      upgradeTarget: result.newerEndpoint === "controller" ? "server" : "controller",
    };
  }
  return {
    updateAvailability: "none",
    currentVersion: server.productVersion,
    availableVersion: server.productVersion,
    minimumVersion: result.requiredMinimumVersion,
  };
}

function preserveCompatibilityState(
  snapshot: SourceServerConnectionStateSnapshot,
): Pick<
  SourceServerConnectionStateSnapshot,
  "updateAvailability" | "currentVersion" | "availableVersion" | "minimumVersion" | "upgradeTarget"
> {
  return {
    ...(snapshot.updateAvailability ? { updateAvailability: snapshot.updateAvailability } : {}),
    ...(snapshot.currentVersion ? { currentVersion: snapshot.currentVersion } : {}),
    ...(snapshot.availableVersion ? { availableVersion: snapshot.availableVersion } : {}),
    ...(snapshot.minimumVersion ? { minimumVersion: snapshot.minimumVersion } : {}),
    ...(snapshot.upgradeTarget ? { upgradeTarget: snapshot.upgradeTarget } : {}),
  };
}

function createConcurrencyGate(limit: number): {
  acquire(): Promise<() => void>;
} {
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    acquire: async () =>
      await new Promise<() => void>((resolve) => {
        const grant = () => {
          active += 1;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            active -= 1;
            waiting.shift()?.();
          });
        };
        if (active < limit) grant();
        else waiting.push(grant);
      }),
  };
}

export class SourceServerConnectionManager {
  private readonly adapters = new Map<string, SourceServerTransportAdapter>();
  private readonly states = new Map<string, SourceServerConnectionStateSnapshot>();
  private readonly compatibilityByProfileId = new Map<
    string,
    ReturnType<typeof preserveCompatibilityState>
  >();
  private readonly onlineBySourceServerId = new Map<string, OnlineConnection>();
  private readonly connectFlights = new Map<string, ConnectFlight>();
  private readonly stateEmitter = new Emitter<SourceServerConnectionStateSnapshot>();
  private readonly reconnectEmitter = new Emitter<ManagedSourceServerConnection>();
  private readonly connectionInvalidatedEmitter =
    new Emitter<SourceServerConnectionInvalidatedEvent>();
  private readonly reconnectInputs = new Map<string, ReconnectInput>();
  private readonly profileIdsBySourceServerId = new Map<string, Set<string>>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly offlineProbeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly updateFlights = new Set<{
    profileId: string;
    sourceServerId?: string;
    controller: AbortController;
  }>();
  public readonly onDidChangeState: Event<SourceServerConnectionStateSnapshot> =
    this.stateEmitter.event;
  public readonly onDidReconnect: Event<ManagedSourceServerConnection> =
    this.reconnectEmitter.event;
  public readonly onDidInvalidateConnection: Event<SourceServerConnectionInvalidatedEvent> =
    this.connectionInvalidatedEmitter.event;
  private readonly createAdapter: NonNullable<
    SourceServerConnectionManagerOptions["createAdapter"]
  >;
  private readonly connectServer: NonNullable<
    SourceServerConnectionManagerOptions["connectServer"]
  >;
  private readonly now: () => number;
  private readonly compatibilityManifest: CompatibilityManifest;

  private readonly operationLogs = new SourceServerOperationLogs(() => this.now());
  public readonly onDidAppendOperationLog = this.operationLogs.onDidAppend;
  public getRecentOperationLogs(profile: Pick<ConnectionProfile, "profileId" | "sourceServerId">) {
    return this.operationLogs.read(profile);
  }

  public constructor(private readonly options: SourceServerConnectionManagerOptions) {
    this.createAdapter =
      options.createAdapter ?? ((kind) => createSourceServerTransportAdapter(kind));
    this.connectServer = options.connectServer ?? connectServerRemoteOverDuplex;
    this.now = options.now ?? Date.now;
    this.compatibilityManifest = options.compatibilityManifest ?? CF_COMPATIBILITY_MANIFEST;
  }

  public async connect(
    options: ConnectSourceServerOptions,
  ): Promise<ManagedSourceServerConnection> {
    return await this.connectForSource(
      { ...options, membershipIntent: options.membershipIntent ?? "add" },
      options.profile.sourceServerId,
    );
  }

  private reusedConnection(
    connection: ManagedSourceServerConnection,
  ): ManagedSourceServerConnection {
    const target = this.reconnectInputs.get(connection.sourceServerId)?.target;
    return {
      sourceServerId: connection.sourceServerId,
      profileId: connection.profileId,
      serverInfo: connection.serverInfo,
      services: connection.services,
      ...(target ? { reusedConnectionTarget: stripRemoteTargetSecrets(target) } : {}),
    };
  }

  private async connectForSource(
    options: ConnectSourceServerOptions,
    sourceServerId: string | undefined,
    recordOperation = true,
  ): Promise<ManagedSourceServerConnection> {
    const existingFlight = this.connectFlights.get(options.profile.profileId);
    if (existingFlight) return this.reusedConnection(await existingFlight.promise);
    const controller = new AbortController();
    const flightOptions = sourceServerId
      ? {
          ...options,
          context: {
            ...options.context,
            signal: options.context?.signal
              ? AbortSignal.any([options.context.signal, controller.signal])
              : controller.signal,
          },
        }
      : options;
    let flight!: ConnectFlight;
    const connect = (context: TransportContext) =>
      this.connectOnce({ ...flightOptions, context }, controller.signal);
    const promise = (
      recordOperation
        ? this.operationLogs.run(
            "connect",
            options.profile,
            options.target,
            flightOptions.context,
            connect,
          )
        : connect(flightOptions.context ?? {})
    ).finally(() => {
      if (this.connectFlights.get(options.profile.profileId) === flight) {
        this.connectFlights.delete(options.profile.profileId);
      }
    });
    flight = {
      promise,
      ...(sourceServerId ? { sourceServerId } : {}),
      controller,
    };
    this.connectFlights.set(options.profile.profileId, flight);
    return await promise;
  }

  public getStateByProfile(profileId: string): SourceServerConnectionStateSnapshot {
    return (
      this.states.get(profileId) ?? {
        profileId,
        state: "absent",
        updatedAt: this.now(),
      }
    );
  }

  public listStates(): SourceServerConnectionStateSnapshot[] {
    return [...this.states.values()];
  }

  public async reconnectOnStartup(
    candidates: Array<{
      profile: ConnectionProfile;
      target: Exclude<RemoteTarget, { kind: "server" }>;
    }>,
    options: { maxConcurrency?: number; timeoutMs?: number } = {},
  ): Promise<StartupReconnectResult[]> {
    if (candidates.length === 0) return [];
    const timeoutMs = options.timeoutMs ?? 10_000;
    const globalGate = createConcurrencyGate(Math.max(1, options.maxConcurrency ?? 3));
    const dockerGate = createConcurrencyGate(1);
    const reconnectCandidate = async (
      candidate: (typeof candidates)[number],
    ): Promise<StartupReconnectResult> => {
      const releaseTransport =
        candidate.target.kind === "docker" ? await dockerGate.acquire() : undefined;
      const releaseGlobal = await globalGate.acquire();
      const abortController = new AbortController();
      const startedAt = Date.now();
      let diagnosticPhase = "queued";
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.connect({
            profile: candidate.profile,
            target: candidate.target,
            membershipIntent: "retain",
            context: { signal: abortController.signal },
            onDiagnosticPhase: (phase) => {
              diagnosticPhase = phase;
            },
          }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`Source Server startup reconnect timed out after ${timeoutMs}ms`));
              abortController.abort();
            }, timeoutMs);
          }),
        ]);
        return { profileId: candidate.profile.profileId, status: "online" };
      } catch (error) {
        if (error instanceof Error && error.message.includes("startup reconnect timed out")) {
          this.options.logWarn?.(
            `Source Server startup reconnect timeout diagnostic profile=${
              candidate.profile.profileId
            } transport=${candidate.target.kind} phase=${diagnosticPhase} elapsedMs=${Date.now() - startedAt}`,
            error,
          );
        }
        return {
          profileId: candidate.profile.profileId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (timer) clearTimeout(timer);
        releaseGlobal();
        releaseTransport?.();
      }
    };
    const [firstCandidate, ...remainingCandidates] = candidates;
    const firstResult = await reconnectCandidate(firstCandidate!);
    return [firstResult, ...(await Promise.all(remainingCandidates.map(reconnectCandidate)))];
  }

  public getOnlineConnection(sourceServerId: string): ManagedSourceServerConnection | undefined {
    return this.onlineBySourceServerId.get(sourceServerId);
  }

  public getFileTransfer(sourceServerId: string): SourceServerFileTransfer {
    const online = this.onlineBySourceServerId.get(sourceServerId);
    const input = this.reconnectInputs.get(sourceServerId);
    if (!online || !input) throw new Error("Source Server file transfer is unavailable");
    const backend = this.getAdapter(input.profile.transport).createFileTransfer(input.target);
    const assertCurrent = () => {
      if (this.onlineBySourceServerId.get(sourceServerId) !== online) {
        throw new Error("Source Server file transfer generation is unavailable");
      }
    };
    return {
      exec: async (command) => {
        assertCurrent();
        return backend.exec(command);
      },
      upload: async (localPath, remotePath, options) => {
        assertCurrent();
        await backend.upload(localPath, remotePath, options);
        assertCurrent();
      },
    };
  }

  public async updateServer(
    options: Parameters<SourceServerConnectionManager["updateServerOnce"]>[0],
  ): Promise<ManagedSourceServerConnection> {
    return this.operationLogs.run(
      "update",
      options.profile,
      options.target,
      options.context,
      (context) => this.updateServerOnce({ ...options, context }),
    );
  }

  private async updateServerOnce(options: {
    profile: ConnectionProfile;
    target: Exclude<RemoteTarget, { kind: "server" }>;
    force?: boolean;
    context?: TransportContext;
    release?: ServerReleaseAsset;
    resolveRelease?: SourceServerConnectionManagerOptions["resolveRelease"];
  }): Promise<ManagedSourceServerConnection> {
    const sourceServerId = options.profile.sourceServerId;
    const previousState = this.getStateByProfile(options.profile.profileId);
    const previousCompatibility = preserveCompatibilityState(previousState);
    const controller = new AbortController();
    const flight = { profileId: options.profile.profileId, sourceServerId, controller };
    const context: TransportContext = {
      ...options.context,
      signal: options.context?.signal
        ? AbortSignal.any([options.context.signal, controller.signal])
        : controller.signal,
    };
    this.updateFlights.add(flight);
    if (sourceServerId) {
      this.clearRecoveryTimers(sourceServerId);
    }
    this.setState(options.profile.profileId, {
      state: "updating",
      ...(sourceServerId ? { sourceServerId } : {}),
      ...previousCompatibility,
    });
    let runningTasks: SourceServerRunningTask[] | undefined;
    try {
      context.signal?.throwIfAborted();
      const adapter = this.getAdapter(options.profile.transport);
      const probe = await adapter.probe(options.target, context);
      context.signal?.throwIfAborted();
      const releaseResolver = options.resolveRelease ?? this.options.resolveRelease;
      const release =
        options.release ?? (releaseResolver ? await releaseResolver(probe, options.target) : null);
      context.signal?.throwIfAborted();
      if (!release) throw new Error("Source Server update release is unavailable");
      await adapter.installOrUpdate(options.target, release, context, {
        force: options.force === true,
      });
      context.signal?.throwIfAborted();
      const online = sourceServerId ? this.onlineBySourceServerId.get(sourceServerId) : undefined;
      if (sourceServerId && online) {
        this.invalidateOnlineConnectionForUpdate(sourceServerId, online);
      }
      context.signal?.throwIfAborted();
      return await this.connectForSource(
        {
          profile: options.profile,
          target: options.target,
          context,
        },
        sourceServerId,
        false,
      );
    } catch (error) {
      controller.signal.throwIfAborted();
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "source-server-update-running-tasks"
      ) {
        try {
          const result = await this.getAdapter(options.profile.transport).exec(
            options.target,
            ["running-tasks", "--json"],
            context,
          );
          if (result.exitCode === 0) {
            const parsed = sourceServerRunningTasksSchema.safeParse(
              JSON.parse(result.stdout.trim()),
            );
            if (parsed.success) runningTasks = parsed.data;
          }
        } catch {
          
        }
      }
      controller.signal.throwIfAborted();
      const normalized = normalizeRemoteConnectionError(error);
      const errorCode = isPublicCfErrorCode(normalized.code) ? normalized.code : undefined;
      const retryable =
        error && typeof error === "object" && "retryable" in error
          ? (error as { retryable?: unknown }).retryable
          : undefined;
      if (sourceServerId && !this.onlineBySourceServerId.has(sourceServerId)) {
        if (this.reconnectInputs.has(sourceServerId)) {
          if (!this.stopAutomaticRecoveryForTerminalFailure(sourceServerId, error)) {
            this.scheduleOnlineRetry(sourceServerId, 0);
          }
        } else {
          this.setState(options.profile.profileId, {
            state: "offline",
            sourceServerId,
            ...previousCompatibility,
            ...(runningTasks ? { runningTasks } : {}),
            ...(errorCode ? { errorCode } : {}),
            retryable: typeof retryable === "boolean" ? retryable : true,
            error: normalized.message,
          });
        }
      } else {
        this.setState(options.profile.profileId, {
          state: previousState.state === "absent" ? "failed" : previousState.state,
          ...(sourceServerId ? { sourceServerId } : {}),
          ...previousCompatibility,
          ...(runningTasks ? { runningTasks } : {}),
          ...(errorCode ? { errorCode } : {}),
          retryable: typeof retryable === "boolean" ? retryable : true,
          error: normalized.message,
        });
      }
      throw error;
    } finally {
      this.updateFlights.delete(flight);
    }
  }

  public disconnect(sourceServerId: string): void {
    this.disconnectSource(sourceServerId);
  }

  public removeProfile(profileId: string): void {
    this.operationLogs.removeProfile(profileId);
    const canceledUpdateSources = new Set<string>();
    for (const flight of this.updateFlights) {
      if (flight.profileId !== profileId) continue;
      if (flight.sourceServerId) canceledUpdateSources.add(flight.sourceServerId);
      this.updateFlights.delete(flight);
      flight.controller.abort(new SourceServerProfileRemovedError(profileId));
    }
    const connectingSourceServerId = this.connectFlights.get(profileId)?.sourceServerId;
    const sourceOwnedOnlyByConnectingProfile =
      connectingSourceServerId &&
      !this.reconnectInputs.has(connectingSourceServerId) &&
      !this.onlineBySourceServerId.has(connectingSourceServerId)
        ? connectingSourceServerId
        : undefined;
    const currentSourceServerId =
      [...this.reconnectInputs].find(([, input]) => input.profile.profileId === profileId)?.[0] ??
      [...this.onlineBySourceServerId].find(([, online]) => online.profileId === profileId)?.[0] ??
      sourceOwnedOnlyByConnectingProfile;
    if (currentSourceServerId) {
      this.disconnectSource(currentSourceServerId, profileId);
      return;
    }

    const flight = this.connectFlights.get(profileId);
    if (flight) {
      this.connectFlights.delete(profileId);
      flight.controller.abort(new SourceServerProfileRemovedError(profileId));
    }
    for (const online of this.onlineBySourceServerId.values()) {
      online.profileIds.delete(profileId);
    }
    this.states.delete(profileId);
    this.compatibilityByProfileId.delete(profileId);
    for (const [sourceServerId, profileIds] of this.profileIdsBySourceServerId) {
      if (!profileIds.delete(profileId)) continue;
      if (profileIds.size === 0) this.profileIdsBySourceServerId.delete(sourceServerId);
    }
    for (const sourceServerId of canceledUpdateSources) {
      const input = this.reconnectInputs.get(sourceServerId);
      if (
        input &&
        !this.onlineBySourceServerId.has(sourceServerId) &&
        this.getStateByProfile(input.profile.profileId).state === "updating" &&
        ![...this.updateFlights].some((flight) => flight.sourceServerId === sourceServerId)
      )
        this.scheduleOnlineRetry(sourceServerId, 0);
    }
  }

  private disconnectSource(sourceServerId: string, removedProfileId?: string): void {
    const online = this.onlineBySourceServerId.get(sourceServerId);
    const reconnectInput = this.reconnectInputs.get(sourceServerId);
    const profileIds = new Set(this.profileIdsBySourceServerId.get(sourceServerId) ?? []);
    for (const profileId of online?.profileIds ?? []) profileIds.add(profileId);
    if (reconnectInput) profileIds.add(reconnectInput.profile.profileId);
    for (const flight of this.updateFlights) {
      if (flight.sourceServerId !== sourceServerId) continue;
      this.updateFlights.delete(flight);
      flight.controller.abort(new SourceServerExplicitDisconnectError(sourceServerId));
      profileIds.add(flight.profileId);
    }

    this.clearRecoveryTimers(sourceServerId);
    for (const [profileId, flight] of this.connectFlights) {
      if (flight.sourceServerId !== sourceServerId) continue;
      if (this.connectFlights.get(profileId) === flight) {
        this.connectFlights.delete(profileId);
      }
      flight.controller.abort(
        profileId === removedProfileId
          ? new SourceServerProfileRemovedError(profileId)
          : new SourceServerExplicitDisconnectError(sourceServerId),
      );
      profileIds.add(profileId);
    }
    if (removedProfileId) profileIds.delete(removedProfileId);
    this.reconnectInputs.delete(sourceServerId);
    this.profileIdsBySourceServerId.delete(sourceServerId);
    if (online) this.onlineBySourceServerId.delete(sourceServerId);
    if (removedProfileId) {
      this.connectionInvalidatedEmitter.fire({
        sourceServerId,
        reason: "profile-removed",
        recoverable: false,
      });
    }
    online?.projectSubscription?.dispose();
    online?.connection.dispose();
    for (const profileId of profileIds) {
      this.setState(profileId, { state: "offline", sourceServerId });
    }
    if (removedProfileId) {
      this.states.delete(removedProfileId);
      this.compatibilityByProfileId.delete(removedProfileId);
    }
  }

  public dispose(): void {
    const reason = Object.assign(new Error("Source Server manager disposed"), {
      code: "remote-connection-canceled",
    });
    for (const flight of this.updateFlights) flight.controller.abort(reason);
    this.updateFlights.clear();
    for (const flight of this.connectFlights.values()) flight.controller.abort(reason);
    this.connectFlights.clear();
    for (const sourceServerId of this.retryTimers.keys()) this.clearRecoveryTimers(sourceServerId);
    for (const sourceServerId of this.offlineProbeTimers.keys())
      this.clearRecoveryTimers(sourceServerId);
    for (const sourceServerId of new Set([
      ...this.reconnectInputs.keys(),
      ...this.onlineBySourceServerId.keys(),
    ])) {
      this.disconnect(sourceServerId);
    }
    for (const adapter of this.adapters.values()) adapter.dispose?.();
    this.adapters.clear();
    this.stateEmitter.dispose();
    this.reconnectEmitter.dispose();
    this.connectionInvalidatedEmitter.dispose();
    this.operationLogs.dispose();
  }

  private async connectOnce(
    options: ConnectSourceServerOptions,
    explicitDisconnectSignal?: AbortSignal,
  ): Promise<ManagedSourceServerConnection> {
    const { profile, target } = options;
    if (target.kind === "server" || profile.transport !== target.kind) {
      throw new Error(
        `Connection Profile ${profile.profileId} transport does not match target ${target.kind}`,
      );
    }
    const signal = options.context?.signal;
    let unpublishedConnection: ServerRemoteConnection | undefined;
    const throwIfAborted = () => {
      explicitDisconnectSignal?.throwIfAborted();
      signal?.throwIfAborted();
    };
    throwIfAborted();
    let commitMembership: ((sourceServerId: string) => Promise<void>) | undefined;
    if (this.options.admitConnection) {
      try {
        commitMembership = await this.options.admitConnection({
          profile,
          intent: options.membershipIntent ?? "retain",
          confirmIdentityChange: options.confirmIdentityChange === true,
        });
      } catch (error) {
        throwIfAborted();
        this.setState(profile.profileId, {
          state: "failed",
          error: error instanceof Error ? error.message : String(error),
          retryable: false,
        });
        throw error;
      }
    }
    throwIfAborted();
    if (profile.sourceServerId) {
      const existing = this.onlineBySourceServerId.get(profile.sourceServerId);
      if (existing) {
        await commitMembership?.(profile.sourceServerId);
        throwIfAborted();
        if (this.onlineBySourceServerId.get(profile.sourceServerId) !== existing)
          throw new Error("Source Server connection changed during admission");
        existing.profileIds.add(profile.profileId);
        this.rememberSourceProfiles(profile.sourceServerId, existing.profileIds);
        this.setState(profile.profileId, {
          state: "online",
          sourceServerId: profile.sourceServerId,
        });
        return this.reusedConnection(existing);
      }
    }
    this.setState(profile.profileId, { state: "bootstrapping" });
    const adapter = this.getAdapter(profile.transport);
    let targetTransportCancelled = false;
    const cancelTargetTransport = () => {
      if (targetTransportCancelled) return;
      targetTransportCancelled = true;
      adapter.cancel?.(target);
    };
    if (signal?.aborted || explicitDisconnectSignal?.aborted) {
      cancelTargetTransport();
      throwIfAborted();
    }
    signal?.addEventListener("abort", cancelTargetTransport, { once: true });
    explicitDisconnectSignal?.addEventListener("abort", cancelTargetTransport, { once: true });
    let ignoreConnectionClose = false;
    try {
      options.onDiagnosticPhase?.("probe");
      const shouldRefreshDevelopmentArtifact =
        this.options.sourceServerArtifactPolicy === "development-content-addressed" &&
        target.kind === "ssh";
      const probe = await adapter.probe(
        target,
        options.context ?? {},
        shouldRefreshDevelopmentArtifact ? { includeReleaseIdentity: true } : undefined,
      );
      throwIfAborted();
      if (probe.installed) {
        const installedVersion = probe.installedVersion?.trim() || "unknown";
        let compatibleInstalledVersion = false;
        try {
          compatibleInstalledVersion =
            compareCompatibilityVersions(
              installedVersion,
              this.compatibilityManifest.minCompatibleVersion,
            ) >= 0;
        } catch {
          compatibleInstalledVersion = false;
        }
        if (!compatibleInstalledVersion) {
          this.setState(profile.profileId, {
            state: "needs-upgrade",
            updateAvailability: "required",
            currentVersion: installedVersion,
            availableVersion: this.compatibilityManifest.productVersion,
            minimumVersion: this.compatibilityManifest.minCompatibleVersion,
            upgradeTarget: "server",
            errorCode: SOURCE_SERVER_UPGRADE_REQUIRED_ERROR_CODE,
            retryable: false,
          });
          throw new SourceServerUpgradeRequiredError(
            profile.profileId,
            "server",
            installedVersion,
            this.compatibilityManifest.minCompatibleVersion,
          );
        }
        if (
          shouldRefreshDevelopmentArtifact &&
          installedVersion === this.compatibilityManifest.productVersion
        ) {
          const releaseResolver = options.resolveRelease ?? this.options.resolveRelease;
          if (!releaseResolver) {
            throw new Error("Development Source Server release is unavailable");
          }
          const release = await releaseResolver(probe, target);
          throwIfAborted();
          if (
            release.version === installedVersion &&
            release.sha256.toLowerCase() !== probe.installedArchiveSha256?.toLowerCase()
          ) {
            this.setState(profile.profileId, {
              state: "needs-upgrade",
              updateAvailability: "required",
              currentVersion: installedVersion,
              availableVersion: release.version,
              minimumVersion: this.compatibilityManifest.minCompatibleVersion,
              upgradeTarget: "server",
              errorCode: SOURCE_SERVER_UPGRADE_REQUIRED_ERROR_CODE,
              retryable: false,
            });
            throw new SourceServerUpgradeRequiredError(
              profile.profileId,
              "server",
              installedVersion,
              this.compatibilityManifest.minCompatibleVersion,
              "development-archive",
            );
          }
        }
      }
      if (!probe.installed) {
        if (profile.sourceServerId) {
          await this.options.directory.markSourceUninstalled?.(profile.profileId);
          throwIfAborted();
        }
        const releaseResolver = options.resolveRelease ?? this.options.resolveRelease;
        const release =
          options.release ??
          (options.allowInstall && releaseResolver
            ? await releaseResolver(probe, target)
            : undefined);
        throwIfAborted();
        if (!release) {
          const previewRelease = releaseResolver
            ? await releaseResolver(probe, target, { metadataOnly: true }).catch(() => undefined)
            : undefined;
          throwIfAborted();
          this.setState(profile.profileId, {
            ...(previewRelease
              ? {
                  installPreview: {
                    version: previewRelease.version,
                    sizeBytes: previewRelease.sizeBytes,
                    ...(probe.installPath ? { installPath: probe.installPath } : {}),
                  },
                }
              : {}),
            state: "needs-install",
            ...(profile.sourceServerId ? { sourceServerId: profile.sourceServerId } : {}),
            errorCode: SOURCE_SERVER_INSTALL_REQUIRED_ERROR_CODE,
            retryable: false,
          });
          throw new SourceServerInstallRequiredError(profile.profileId);
        }
        await adapter.installOrUpdate(target, release, options.context ?? {});
        throwIfAborted();
      }
      options.onDiagnosticPhase?.("daemon");
      const ingress = await adapter.ensureDaemon(target, options.context ?? {}, {
        observedStatus: probe.daemonStatus,
      });
      throwIfAborted();
      let published: { sourceServerId: string; connection: ServerRemoteConnection } | undefined;
      let closedBeforePublish: string | undefined;
      options.onDiagnosticPhase?.("protocol-handshake");
      const connection = await this.connectServer({
        ingressToken: ingress.ingressToken,
        createConnection: async () =>
          await adapter.openChannel(target, ingress, options.context ?? {}),
        onClose: ({ reason }) => {
          if (ignoreConnectionClose) return;
          if (!published) {
            closedBeforePublish = reason || "connection closed";
            return;
          }
          this.handleUnexpectedClose(published.sourceServerId, reason, published.connection);
        },
      });
      unpublishedConnection = connection;
      throwIfAborted();
      const compatibility = connection.serverInfo.compatibility;
      if (!compatibility) {
        this.setState(profile.profileId, {
          state: "needs-upgrade",
          updateAvailability: "required",
          currentVersion: connection.serverInfo.version,
          availableVersion: this.compatibilityManifest.productVersion,
          minimumVersion: this.compatibilityManifest.minCompatibleVersion,
          upgradeTarget: "server",
          errorCode: SOURCE_SERVER_UPGRADE_REQUIRED_ERROR_CODE,
          retryable: false,
        });
        throw new SourceServerUpgradeRequiredError(
          profile.profileId,
          "server",
          connection.serverInfo.version,
          this.compatibilityManifest.minCompatibleVersion,
        );
      }
      const compatibilityResult = evaluateSourceServerCompatibility(
        this.compatibilityManifest,
        compatibility,
      );
      const compatibilityState = buildCompatibilityState(this.compatibilityManifest, compatibility);
      if (!compatibilityResult.compatible && compatibilityResult.upgradeTarget) {
        this.setState(profile.profileId, {
          state: "needs-upgrade",
          ...compatibilityState,
          errorCode: SOURCE_SERVER_UPGRADE_REQUIRED_ERROR_CODE,
          retryable: false,
        });
        throw new SourceServerUpgradeRequiredError(
          profile.profileId,
          compatibilityResult.upgradeTarget,
          compatibilityResult.olderVersion,
          compatibilityResult.requiredMinimumVersion,
        );
      }
      const sourceServerId = connection.serverInfo.serverId;
      const connectedAt = this.now();
      options.onDiagnosticPhase?.("directory-record");
      const handshakeResult = await this.options.directory.recordHandshake(
        profile.profileId,
        {
          sourceServerId,
          osUser: connection.serverInfo.identity?.osUser,
          hostname: connection.serverInfo.identity?.hostname,
          version:
            connection.serverInfo.compatibility?.productVersion ?? connection.serverInfo.version,
          connectedAt,
          workspaces: connection.serverInfo.workspaces,
        },
        ...(options.confirmIdentityChange ? [{ confirmIdentityChange: true }] : []),
      );
      throwIfAborted();
      if (handshakeResult.identityChanged && options.confirmIdentityChange !== true) {
        this.setState(profile.profileId, {
          state: "identity-change-pending",
          sourceServerId: profile.sourceServerId,
          pendingSourceServerId: sourceServerId,
          errorCode: SOURCE_SERVER_IDENTITY_CHANGE_PENDING_ERROR_CODE,
          retryable: false,
        });
        throw new SourceServerIdentityChangePendingError(profile.profileId, sourceServerId);
      }
      const effectiveProfile = handshakeResult.effectiveProfile ?? profile;
      if (closedBeforePublish !== undefined && !this.onlineBySourceServerId.has(sourceServerId))
        throw new SourceServerHandshakeClosedError(closedBeforePublish);
      await commitMembership?.(sourceServerId);
      throwIfAborted();
      options.onDiagnosticPhase?.("publish-online");
      if (effectiveProfile.profileId !== profile.profileId) {
        this.setState(profile.profileId, {
          state: "offline",
          ...(profile.sourceServerId ? { sourceServerId: profile.sourceServerId } : {}),
        });
      }

      const existing = this.onlineBySourceServerId.get(sourceServerId);
      if (existing) {
        existing.profileIds.add(effectiveProfile.profileId);
        this.rememberSourceProfiles(sourceServerId, existing.profileIds);
        this.setState(effectiveProfile.profileId, {
          state: "online",
          sourceServerId,
          ...compatibilityState,
        });
        return this.reusedConnection(existing);
      }
      if (closedBeforePublish !== undefined) {
        throw new SourceServerHandshakeClosedError(closedBeforePublish);
      }
      const managed: OnlineConnection = {
        sourceServerId,
        profileId: effectiveProfile.profileId,
        serverInfo: connection.serverInfo,
        services: connection.services,
        connection,
        profileIds: new Set([effectiveProfile.profileId]),
      };
      if (this.options.onProjectChange) {
        managed.projectSubscription = connection.services.broadcastService.onMessage((event) => {
          if (
            event.channel === "state:projects" &&
            this.onlineBySourceServerId.get(sourceServerId) === managed
          )
            this.options.onProjectChange?.(sourceServerId);
        });
      }
      const isRepublish = this.reconnectInputs.has(sourceServerId);
      this.onlineBySourceServerId.set(sourceServerId, managed);
      published = { sourceServerId, connection };
      unpublishedConnection = undefined;
      this.rememberSourceProfiles(sourceServerId, managed.profileIds);
      this.clearRecoveryTimers(sourceServerId);
      this.reconnectInputs.set(sourceServerId, {
        profile: effectiveProfile,
        target,
        context: {},
      });
      this.setState(effectiveProfile.profileId, {
        state: "online",
        sourceServerId,
        ...compatibilityState,
      });
      if (isRepublish) this.reconnectEmitter.fire(managed);
      return managed;
    } catch (error) {
      if (
        error instanceof SourceServerUpgradeRequiredError &&
        !signal?.aborted &&
        !explicitDisconnectSignal?.aborted
      ) {
        await options.onAuthenticatedUpgradeRequired?.();
      }
      if (explicitDisconnectSignal?.aborted) {
        throw explicitDisconnectSignal.reason;
      }
      if (
        error instanceof SourceServerInstallRequiredError ||
        error instanceof SourceServerUpgradeRequiredError ||
        error instanceof SourceServerIdentityChangePendingError
      )
        throw error;
      const normalized = normalizeRemoteConnectionError(error);
      const errorCode = isPublicCfErrorCode(normalized.code) ? normalized.code : undefined;
      const retryable =
        error && typeof error === "object" && "retryable" in error
          ? (error as { retryable?: unknown }).retryable
          : undefined;
      this.setState(profile.profileId, {
        state: "failed",
        error: normalized.message,
        ...(errorCode ? { errorCode } : {}),
        ...(typeof retryable === "boolean" ? { retryable } : {}),
      });
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancelTargetTransport);
      explicitDisconnectSignal?.removeEventListener("abort", cancelTargetTransport);
      if (unpublishedConnection) {
        ignoreConnectionClose = true;
        unpublishedConnection.dispose();
      }
    }
  }

  private getAdapter(kind: "ssh" | "wsl" | "docker"): SourceServerTransportAdapter {
    let adapter = this.adapters.get(kind);
    if (!adapter) {
      adapter = this.createAdapter(kind);
      this.adapters.set(kind, adapter);
    }
    return adapter;
  }

  private handleUnexpectedClose(
    sourceServerId: string,
    reason: string,
    connection: ServerRemoteConnection,
  ): void {
    const online = this.onlineBySourceServerId.get(sourceServerId);
    if (!online || online.connection !== connection) return;
    if ([...this.updateFlights].some((flight) => flight.sourceServerId === sourceServerId)) {
      this.invalidateOnlineConnectionForUpdate(sourceServerId, online);
      return;
    }
    this.onlineBySourceServerId.delete(sourceServerId);
    online.projectSubscription?.dispose();
    online.connection.dispose();
    for (const profileId of online.profileIds) {
      this.setState(profileId, {
        state: "retrying",
        sourceServerId,
        ...(reason ? { error: reason } : {}),
        recoveryAttempt: 1,
        recoveryLimit: ONLINE_RETRY_DELAYS_MS.length,
      });
    }
    this.scheduleOnlineRetry(sourceServerId, 0);
  }

  private invalidateOnlineConnectionForUpdate(
    sourceServerId: string,
    online: OnlineConnection,
  ): void {
    if (this.onlineBySourceServerId.get(sourceServerId) !== online) return;
    this.onlineBySourceServerId.delete(sourceServerId);
    for (const profileId of online.profileIds) {
      this.setState(profileId, { state: "updating", sourceServerId });
    }
    this.connectionInvalidatedEmitter.fire({
      sourceServerId,
      reason: "update",
    });
    online.projectSubscription?.dispose();
    online.connection.dispose();
  }

  private scheduleOnlineRetry(sourceServerId: string, attempt: number): void {
    const input = this.reconnectInputs.get(sourceServerId);
    const delay = ONLINE_RETRY_DELAYS_MS[attempt];
    if (!input || delay === undefined) {
      this.enterOfflineProbe(sourceServerId);
      return;
    }
    const existing = this.retryTimers.get(sourceServerId);
    if (existing) clearTimeout(existing);
    for (const profileId of this.profileIdsForSource(sourceServerId, input.profile.profileId)) {
      this.setState(profileId, {
        state: "retrying",
        sourceServerId,
        recoveryAttempt: attempt + 1,
        recoveryLimit: ONLINE_RETRY_DELAYS_MS.length,
      });
    }
    const timer = setTimeout(() => {
      this.retryTimers.delete(sourceServerId);
      void this.connectForSource(
        {
          profile: input.profile,
          target: input.target,
          context: input.context,
        },
        sourceServerId,
      ).catch((error) => {
        if (
          error instanceof SourceServerExplicitDisconnectError ||
          error instanceof SourceServerProfileRemovedError ||
          this.stopAutomaticRecoveryForTerminalFailure(sourceServerId, error)
        ) {
          return;
        }
        if (attempt + 1 < ONLINE_RETRY_DELAYS_MS.length) {
          this.scheduleOnlineRetry(sourceServerId, attempt + 1);
        } else {
          this.enterOfflineProbe(sourceServerId, error);
        }
      });
    }, delay);
    this.retryTimers.set(sourceServerId, timer);
  }

  private enterOfflineProbe(sourceServerId: string, error?: unknown): void {
    const input = this.reconnectInputs.get(sourceServerId);
    if (!input) return;
    const normalized = error === undefined ? undefined : normalizeRemoteConnectionError(error);
    if (normalized) {
      this.options.logWarn?.(
        `[source-server] recovery budget exhausted source=${sourceServerId}`,
        error instanceof Error ? error : new Error(normalized.message),
      );
    }
    const errorCode =
      normalized?.code &&
      normalized.code !== "remote-connection-unknown" &&
      isPublicCfErrorCode(normalized.code)
        ? normalized.code
        : REMOTE_RECOVERY_BUDGET_EXHAUSTED_ERROR_CODE;
    for (const profileId of this.profileIdsForSource(sourceServerId, input.profile.profileId)) {
      this.setState(profileId, {
        state: "offline",
        sourceServerId,
        recoveryAttempt: ONLINE_RETRY_DELAYS_MS.length,
        recoveryLimit: ONLINE_RETRY_DELAYS_MS.length,
        recoveryBudgetExhausted: true,
        retryable: true,
        ...(normalized ? { error: normalized.message } : {}),
        ...(errorCode ? { errorCode } : {}),
      });
    }
    const existing = this.offlineProbeTimers.get(sourceServerId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.offlineProbeTimers.delete(sourceServerId);
      void this.connectForSource(
        {
          profile: input.profile,
          target: input.target,
          context: input.context,
        },
        sourceServerId,
      ).catch((error) => {
        if (
          error instanceof SourceServerExplicitDisconnectError ||
          error instanceof SourceServerProfileRemovedError ||
          this.stopAutomaticRecoveryForTerminalFailure(sourceServerId, error)
        ) {
          return;
        }
        this.enterOfflineProbe(sourceServerId, error);
      });
    }, OFFLINE_PROBE_INTERVAL_MS);
    this.offlineProbeTimers.set(sourceServerId, timer);
  }

  private stopAutomaticRecoveryForTerminalFailure(sourceServerId: string, error: unknown): boolean {
    const input = this.reconnectInputs.get(sourceServerId);
    const ownerState = input ? this.states.get(input.profile.profileId) : undefined;
    const normalized = normalizeRemoteConnectionError(error);
    if (
      readErrorRetryable(error) !== false &&
      !isAutomaticRecoveryUserActionCode(normalized.code) &&
      !isSourceServerAutomaticRecoveryTerminalState(ownerState)
    ) {
      return false;
    }
    this.clearRecoveryTimers(sourceServerId);
    if (input && !isSourceServerAutomaticRecoveryTerminalState(ownerState)) {
      this.setState(input.profile.profileId, {
        state: "failed",
        sourceServerId,
        ...this.compatibilityByProfileId.get(input.profile.profileId),
        error: normalized.message,
        ...(isPublicCfErrorCode(normalized.code) ? { errorCode: normalized.code } : {}),
        retryable: false,
      });
    }
    if (input) {
      for (const profileId of this.profileIdsForSource(sourceServerId, input.profile.profileId)) {
        if (profileId === input.profile.profileId) continue;
        this.setState(profileId, {
          state: "offline",
          sourceServerId,
          error: normalized.message,
          ...(isPublicCfErrorCode(normalized.code) ? { errorCode: normalized.code } : {}),
          retryable: false,
        });
      }
    }
    return true;
  }

  private profileIdsForSource(sourceServerId: string, fallbackProfileId: string): string[] {
    const remembered = this.profileIdsBySourceServerId.get(sourceServerId);
    return remembered && remembered.size > 0 ? [...remembered] : [fallbackProfileId];
  }

  private rememberSourceProfiles(sourceServerId: string, profileIds: Iterable<string>): void {
    const remembered = this.profileIdsBySourceServerId.get(sourceServerId) ?? new Set<string>();
    for (const profileId of profileIds) remembered.add(profileId);
    this.profileIdsBySourceServerId.set(sourceServerId, remembered);
  }

  private clearRecoveryTimers(sourceServerId: string): void {
    const retryTimer = this.retryTimers.get(sourceServerId);
    if (retryTimer) clearTimeout(retryTimer);
    this.retryTimers.delete(sourceServerId);
    const probeTimer = this.offlineProbeTimers.get(sourceServerId);
    if (probeTimer) clearTimeout(probeTimer);
    this.offlineProbeTimers.delete(sourceServerId);
  }

  private setState(
    profileId: string,
    patch: Omit<SourceServerConnectionStateSnapshot, "profileId" | "updatedAt">,
  ): void {
    const previous = this.states.get(profileId);
    const inheritedCompatibility =
      patch.state === "retrying" || patch.state === "offline" || patch.state === "updating"
        ? (this.compatibilityByProfileId.get(profileId) ??
          (previous ? preserveCompatibilityState(previous) : {}))
        : {};
    const snapshot: SourceServerConnectionStateSnapshot = {
      profileId,
      ...inheritedCompatibility,
      ...patch,
      updatedAt: this.now(),
    };
    if (snapshot.currentVersion || snapshot.updateAvailability) {
      this.compatibilityByProfileId.set(profileId, preserveCompatibilityState(snapshot));
    }
    this.states.set(profileId, snapshot);
    if (previous?.state === "online" && snapshot.state !== "online" && previous.sourceServerId) {
      void this.options.directory
        .recordLastOnline?.(previous.sourceServerId, snapshot.updatedAt)
        .catch((error: unknown) =>
          this.options.logWarn?.(
            "Failed to persist Source Server last online time",
            error instanceof Error ? error : new Error(String(error)),
          ),
        );
    }
    this.stateEmitter.fire(snapshot);
  }
}
