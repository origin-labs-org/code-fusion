import {
  ProviderConfigService,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@origin-ai/cf-provider";
import { NodeCfBuiltinProviderConfigSource } from "./cf-builtin-provider-config-source.js";
import {
  EndpointScopedCfBuiltinSource,
  type EndpointScopedCfBuiltinSourceOptions,
} from "./endpoint-scoped-cf-builtin-source.js";
import {
  CfBuiltinRemoteSynchronizer,
  type CfBuiltinRemoteSynchronizerOptions,
  type CfBuiltinRefreshResult,
} from "./cf-builtin-remote-synchronizer.js";
import {
  NodePersonalProviderConfigRepository,
  type PersonalProviderConfigRecoveryEvent,
} from "./personal-provider-config-repository.js";

export interface NodeProviderConfigRuntimeOptions {
  readonly cfBuiltinFilePath: string;
  readonly cfBuiltinActiveFilePath?: string;
  readonly cfBuiltinRemote?: Omit<CfBuiltinRemoteSynchronizerOptions, "source">;
  readonly cfBuiltinEnvironment?: Omit<
    EndpointScopedCfBuiltinSourceOptions,
    "bundledFilePath"
  >;
  readonly onCfBuiltinRefreshError?: (error: unknown) => void;
  readonly onPersonalConfigRecovery?: (event: PersonalProviderConfigRecoveryEvent) => void;
  readonly onPersonalConfigPollingError?: (error: unknown) => void;
  readonly personalFilePath: string;
  readonly personalPollingIntervalMs?: number | false;
  readonly importLegacy?: (
    cfBuiltin: ProviderConfigLayerSnapshot,
  ) => Promise<ProviderConfigLayerUpdate | null>;
  readonly watch?: boolean;
}

export class NodeProviderConfigRuntime {
  readonly configService: ProviderConfigService;
  readonly #cfBuiltinSource:
    | NodeCfBuiltinProviderConfigSource
    | EndpointScopedCfBuiltinSource;
  readonly #personalRepository: NodePersonalProviderConfigRepository;
  readonly #remoteSynchronizer?: CfBuiltinRemoteSynchronizer;
  readonly #onRemoteRefreshError?: (error: unknown) => void;
  #startPromise: Promise<void> | null = null;
  #disposed = false;
  readonly #checkListeners = new Set<() => Promise<void>>();
  #checkTimer: ReturnType<typeof setInterval> | null = null;
  #checkInFlight: Promise<void> | null = null;

  constructor(options: NodeProviderConfigRuntimeOptions) {
    this.#cfBuiltinSource = options.cfBuiltinEnvironment
      ? new EndpointScopedCfBuiltinSource({
          bundledFilePath: options.cfBuiltinFilePath,
          ...options.cfBuiltinEnvironment,
        })
      : new NodeCfBuiltinProviderConfigSource({
          bundledFilePath: options.cfBuiltinFilePath,
          activeFilePath: options.cfBuiltinActiveFilePath,
          watch: options.watch,
        });
    this.#remoteSynchronizer =
      options.cfBuiltinRemote &&
      this.#cfBuiltinSource instanceof NodeCfBuiltinProviderConfigSource
        ? new CfBuiltinRemoteSynchronizer({
            source: this.#cfBuiltinSource,
            ...options.cfBuiltinRemote,
          })
        : undefined;
    this.#onRemoteRefreshError = options.onCfBuiltinRefreshError;
    this.#personalRepository = new NodePersonalProviderConfigRepository({
      filePath: options.personalFilePath,
      onRecovery: options.onPersonalConfigRecovery,
      onPollingError: options.onPersonalConfigPollingError,
      pollingIntervalMs: options.personalPollingIntervalMs,
      ...(options.importLegacy
        ? {
            importLegacy: async () => options.importLegacy!(await this.#cfBuiltinSource.read()),
          }
        : {}),
    });
    this.configService = new ProviderConfigService({
      cfBuiltinSource: this.#cfBuiltinSource,
      personalRepository: this.#personalRepository,
    });
  }

  resolveCfBuiltinActiveFilePath(): Promise<string> {
    return this.#cfBuiltinSource instanceof NodeCfBuiltinProviderConfigSource
      ? Promise.resolve(this.#cfBuiltinSource.activeFilePath)
      : this.#cfBuiltinSource.resolveActiveFilePath();
  }

  get personalRepository(): import("@origin-ai/cf-provider").PersonalProviderConfigRepository {
    return this.#personalRepository;
  }

  
  onDidCheckCfBuiltin(listener: () => Promise<void>): () => void {
    this.#checkListeners.add(listener);
    return () => this.#checkListeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.#disposed) throw new Error("NodeProviderConfigRuntime 已 dispose");
    if (this.#startPromise) return this.#startPromise;
    const startPromise = this.configService.read().then(() => {
      if (this.#disposed) return;
      void this.#checkBackground();
      if (
        this.#remoteSynchronizer ||
        this.#cfBuiltinSource instanceof EndpointScopedCfBuiltinSource ||
        this.#checkListeners.size > 0
      ) {
        this.#checkTimer = setInterval(() => {
          void this.#checkBackground();
        }, 60_000);
        this.#checkTimer.unref?.();
      }
    });
    this.#startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.#startPromise === startPromise) this.#startPromise = null;
    });
    return startPromise;
  }

  refreshCfBuiltin(options?: { readonly force?: boolean }): Promise<CfBuiltinRefreshResult> {
    if (this.#disposed) return Promise.resolve("disposed");
    if (this.#cfBuiltinSource instanceof EndpointScopedCfBuiltinSource) {
      return this.#cfBuiltinSource.refresh(options);
    }
    return this.#remoteSynchronizer?.refresh(options) ?? Promise.resolve("skipped");
  }

  #checkBackground(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#checkInFlight) return this.#checkInFlight;
    const check = Promise.allSettled([
      this.refreshCfBuiltin(),
      ...[...this.#checkListeners].map((listener) => Promise.resolve().then(listener)),
    ])
      .then((results) => {
        if (this.#disposed) return;
        for (const result of results)
          if (result.status === "rejected") this.#onRemoteRefreshError?.(result.reason);
      })
      .finally(() => {
        if (this.#checkInFlight === check) this.#checkInFlight = null;
      });
    this.#checkInFlight = check;
    return check;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#checkTimer) clearInterval(this.#checkTimer);
    this.#checkTimer = null;
    this.#checkListeners.clear();
    this.#remoteSynchronizer?.dispose();
    this.configService.dispose();
    this.#personalRepository.dispose();
    this.#cfBuiltinSource.dispose();
  }
}

export function createNodeProviderConfigRuntime(
  options: NodeProviderConfigRuntimeOptions,
): NodeProviderConfigRuntime {
  return new NodeProviderConfigRuntime(options);
}
