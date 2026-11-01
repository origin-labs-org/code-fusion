import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ModelConfigRules,
  ProviderConfigMap,
  type PersonalProviderConfigRepository,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@origin-ai/cf-provider";
import { atomicWritePrivateTextFile, withFileLock } from "@origin-ai/cf-shared/node";
import {
  decodeProviderConfigFile,
  encodeProviderConfigFile,
} from "./provider-config-file-codec.js";

export interface NodePersonalProviderConfigRepositoryOptions {
  readonly filePath: string;
  readonly importLegacy?: () => Promise<ProviderConfigLayerUpdate | null>;
  readonly onRecovery?: (event: PersonalProviderConfigRecoveryEvent) => void;
  readonly onPollingError?: (error: unknown) => void;
  readonly pollingIntervalMs?: number | false;
}

export interface PersonalProviderConfigRecoveryEvent {
  readonly error: unknown;
}

export class NodePersonalProviderConfigRepository implements PersonalProviderConfigRepository {
  readonly #filePath: string;
  readonly #importLegacy?: () => Promise<ProviderConfigLayerUpdate | null>;
  readonly #onRecovery?: (event: PersonalProviderConfigRecoveryEvent) => void;
  readonly #onPollingError?: (error: unknown) => void;
  readonly #pollingIntervalMs: number | false;
  readonly #listeners = new Set<(reason: string) => void>();
  #pollingTimer: ReturnType<typeof setTimeout> | null = null;
  #pollingInFlight = false;
  #writeGeneration = 0;
  #pollingErrorActive = false;
  #observedRevision: string | null = null;
  #disposed = false;

  constructor(options: NodePersonalProviderConfigRepositoryOptions) {
    if (!options.filePath.trim()) throw new Error("Personal Provider Config filePath 不能为空");
    this.#filePath = options.filePath;
    this.#importLegacy = options.importLegacy;
    this.#onRecovery = options.onRecovery;
    this.#onPollingError = options.onPollingError;
    this.#pollingIntervalMs = options.pollingIntervalMs ?? 1_000;
    if (this.#pollingIntervalMs !== false && this.#pollingIntervalMs <= 0) {
      throw new Error("Personal Provider Config pollingIntervalMs 必须大于 0");
    }
  }

  async read(): Promise<ProviderConfigLayerSnapshot> {
    this.#assertNotDisposed();
    try {
      const snapshot = await this.#readCurrent();
      this.#observedRevision ??= snapshot.revision;
      return snapshot;
    } catch (error) {
      const snapshot = this.#recoverInvalidFile(error);
      this.#observedRevision ??= snapshot.revision;
      return snapshot;
    } finally {
      this.#ensurePolling();
    }
  }

  async update(
    transform: (current: ProviderConfigLayerSnapshot) => ProviderConfigLayerUpdate,
  ): Promise<ProviderConfigLayerSnapshot> {
    this.#assertNotDisposed();
    try {
      const snapshot = await withFileLock(this.#filePath, async () => {
        const current = await this.#readLocked();
        const next = transform(current);
        const update = Object.freeze({
          providers: next.providers,
          models: next.models,
          providerOrder: next.providerOrder,
          defaultModelSelection: next.defaultModelSelection,
        });
        const committed = await this.#writeLocked(update);
        const snapshot = snapshotFromUpdate(committed);
        this.#observedRevision = snapshot.revision;
        return snapshot;
      });
      this.#emit("updated");
      return snapshot;
    } finally {
      this.#ensurePolling();
    }
  }

  onDidChange(listener: (reason: string) => void): () => void {
    this.#assertNotDisposed();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#pollingTimer) clearTimeout(this.#pollingTimer);
    this.#pollingTimer = null;
    this.#listeners.clear();
  }

  async #readCurrent(): Promise<ProviderConfigLayerSnapshot> {
    const file = await readJsonFileIfExists(this.#filePath);
    if (file === null && !this.#importLegacy) return snapshotFromUpdate(emptyUpdate());
    if (file !== null) {
      const update = decodeProviderConfigFile(file.value);
      if (JSON.stringify(file.value) === JSON.stringify(encodeProviderConfigFile(update))) {
        return snapshotFromUpdate(update);
      }
    }
    return withFileLock(this.#filePath, () => this.#readLocked());
  }

  async #readLocked(): Promise<ProviderConfigLayerSnapshot> {
    const file = await readJsonFileIfExists(this.#filePath);
    if (file === null) {
      const imported = await this.#importLegacy?.();
      const update = imported ?? emptyUpdate();
      if (imported) return snapshotFromUpdate(await this.#writeLocked(update));
      return snapshotFromUpdate(update);
    }

    const update = decodeProviderConfigFile(file.value);
    const encoded = encodeProviderConfigFile(update);
    if (JSON.stringify(file.value) !== JSON.stringify(encoded)) {
      await this.#writeLocked(update);
    }
    return snapshotFromUpdate(update);
  }

  async #writeLocked(update: ProviderConfigLayerUpdate): Promise<ProviderConfigLayerUpdate> {
    const canonical = decodeProviderConfigFile(encodeProviderConfigFile(update));
    const encoded = encodeProviderConfigFile(canonical);
    await atomicWritePrivateTextFile(this.#filePath, JSON.stringify(encoded, null, 2));
    this.#writeGeneration += 1;
    return canonical;
  }

  async #readPollingSnapshot(): Promise<ProviderConfigLayerSnapshot> {
    const file = await readJsonFileIfExists(this.#filePath);
    if (file === null) return snapshotFromUpdate(emptyUpdate());
    return snapshotFromUpdate(decodeProviderConfigFile(file.value));
  }

  #recoverInvalidFile(error: unknown): ProviderConfigLayerSnapshot {
    this.#reportRecovery({ error });
    return snapshotFromUpdate(emptyUpdate());
  }

  #reportRecovery(event: PersonalProviderConfigRecoveryEvent): void {
    try {
      this.#onRecovery?.(Object.freeze(event));
    } catch {
    }
  }

  #ensurePolling(): void {
    if (
      this.#pollingIntervalMs === false ||
      this.#pollingTimer ||
      this.#pollingInFlight ||
      this.#disposed
    )
      return;
    this.#pollingTimer = setTimeout(() => {
      this.#pollingTimer = null;
      void this.#pollOnce();
    }, this.#pollingIntervalMs);
    this.#pollingTimer.unref?.();
  }

  async #pollOnce(): Promise<void> {
    this.#pollingInFlight = true;
    const writeGeneration = this.#writeGeneration;
    try {
      const snapshot = await this.#readPollingSnapshot();
      if (writeGeneration !== this.#writeGeneration) return;
      this.#pollingErrorActive = false;
      if (this.#disposed || snapshot.revision === this.#observedRevision) return;
      this.#observedRevision = snapshot.revision;
      this.#emit("poll-changed");
    } catch (error) {
      if (this.#disposed || writeGeneration !== this.#writeGeneration) return;
      if (!this.#pollingErrorActive) {
        this.#pollingErrorActive = true;
        try {
          this.#onPollingError?.(error);
        } catch {
        }
        this.#emit("poll-error");
      }
    } finally {
      this.#pollingInFlight = false;
      this.#ensurePolling();
    }
  }

  #emit(reason: string): void {
    if (this.#disposed) return;
    for (const listener of this.#listeners) listener(reason);
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new Error("NodePersonalProviderConfigRepository 已 dispose");
  }
}

export function createNodePersonalProviderConfigRepository(
  options: NodePersonalProviderConfigRepositoryOptions,
): NodePersonalProviderConfigRepository {
  return new NodePersonalProviderConfigRepository(options);
}

async function readJsonFileIfExists(filePath: string): Promise<{ readonly value: unknown } | null> {
  try {
    const text = await readFile(filePath, "utf8");
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    if (isFileNotFound(error)) return null;
    throw error;
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function emptyUpdate(): ProviderConfigLayerUpdate {
  return Object.freeze({
    providers: ProviderConfigMap.empty(),
    models: ModelConfigRules.empty(),
    providerOrder: [],
  });
}

function snapshotFromUpdate(update: ProviderConfigLayerUpdate): ProviderConfigLayerSnapshot {
  const content = JSON.stringify(encodeProviderConfigFile(update));
  return Object.freeze({
    revision: createHash("sha256").update(content).digest("hex"),
    providers: update.providers,
    models: update.models,
    providerOrder: update.providerOrder,
    defaultModelSelection: update.defaultModelSelection,
  });
}
