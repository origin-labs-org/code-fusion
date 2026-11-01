import type { ProviderConfigLayerSnapshot, ProviderSource } from "@origin-ai/cf-provider";
import {
  normalizeCfBuiltinEndpointOrigin,
  resolveCfBuiltinCachePaths,
} from "./cf-builtin-cache-paths.js";
import { NodeCfBuiltinProviderConfigSource } from "./cf-builtin-provider-config-source.js";
import {
  CfBuiltinRemoteSynchronizer,
  type CfBuiltinRefreshResult,
  type CfBuiltinRemoteSynchronizerOptions,
} from "./cf-builtin-remote-synchronizer.js";

export interface EndpointScopedCfBuiltinSourceOptions {
  readonly bundledFilePath: string;
  readonly environmentConfigRoot: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly resolveEndpointOrigin: () => string | Promise<string>;
  readonly fetchRelease: CfBuiltinRemoteSynchronizerOptions["fetchRelease"];
  readonly onRefreshResult?: CfBuiltinRemoteSynchronizerOptions["onRefreshResult"];
  readonly watch?: boolean;
}

export class EndpointScopedCfBuiltinSource implements ProviderSource<ProviderConfigLayerSnapshot> {
  readonly #options: EndpointScopedCfBuiltinSourceOptions;
  readonly #listeners = new Set<(reason: string) => void>();
  #current: CurrentEndpointSource | null = null;
  #ensureInFlight: Promise<CurrentEndpointSource> | null = null;
  #disposed = false;

  constructor(options: EndpointScopedCfBuiltinSourceOptions) {
    this.#options = options;
  }

  async read(): Promise<ProviderConfigLayerSnapshot> {
    return (await this.#ensureCurrent()).source.read();
  }

  onDidChange(listener: (reason: string) => void): () => void {
    this.#assertNotDisposed();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async refresh(options?: { readonly force?: boolean }): Promise<CfBuiltinRefreshResult> {
    return (await this.#ensureCurrent()).synchronizer.refresh(options);
  }

  
  async resolveActiveFilePath(): Promise<string> {
    return (await this.#ensureCurrent()).activeFilePath;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#current?.dispose();
    this.#current = null;
    this.#listeners.clear();
  }

  async #ensureCurrent(): Promise<CurrentEndpointSource> {
    this.#assertNotDisposed();
    if (this.#ensureInFlight) return this.#ensureInFlight;
    const ensure = this.#resolveCurrent().finally(() => {
      if (this.#ensureInFlight === ensure) this.#ensureInFlight = null;
    });
    this.#ensureInFlight = ensure;
    return ensure;
  }

  async #resolveCurrent(): Promise<CurrentEndpointSource> {
    const endpointOrigin = normalizeCfBuiltinEndpointOrigin(
      await this.#options.resolveEndpointOrigin(),
    );
    const paths = resolveCfBuiltinCachePaths({
      environmentConfigRoot: this.#options.environmentConfigRoot,
      platform: this.#options.platform,
      appVersion: this.#options.appVersion,
      cfEndpointOrigin: endpointOrigin,
    });
    if (this.#current?.activeFilePath === paths.activeFilePath) return this.#current;

    const source = new NodeCfBuiltinProviderConfigSource({
      bundledFilePath: this.#options.bundledFilePath,
      activeFilePath: paths.activeFilePath,
      watch: this.#options.watch,
    });
    const sourceDispose = source.onDidChange((reason) => this.#emit(reason));
    const synchronizer = new CfBuiltinRemoteSynchronizer({
      source,
      controlFilePath: paths.controlFilePath,
      resolveEndpointKey: async () =>
        normalizeCfBuiltinEndpointOrigin(await this.#options.resolveEndpointOrigin()),
      fetchRelease: this.#options.fetchRelease,
      onRefreshResult: this.#options.onRefreshResult,
    });
    try {
      await source.read();
      this.#assertNotDisposed();
    } catch (error) {
      sourceDispose();
      synchronizer.dispose();
      source.dispose();
      throw error;
    }

    const previous = this.#current;
    const current = new CurrentEndpointSource(
      paths.activeFilePath,
      source,
      synchronizer,
      sourceDispose,
    );
    this.#current = current;
    previous?.dispose();
    if (previous) this.#emit("endpoint-changed");
    return current;
  }

  #emit(reason: string): void {
    if (this.#disposed) return;
    for (const listener of this.#listeners) listener(reason);
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new Error("EndpointScopedCfBuiltinSource 已 dispose");
  }
}

class CurrentEndpointSource {
  constructor(
    readonly activeFilePath: string,
    readonly source: NodeCfBuiltinProviderConfigSource,
    readonly synchronizer: CfBuiltinRemoteSynchronizer,
    readonly sourceDispose: () => void,
  ) {}

  dispose(): void {
    this.sourceDispose();
    this.synchronizer.dispose();
    this.source.dispose();
  }
}
