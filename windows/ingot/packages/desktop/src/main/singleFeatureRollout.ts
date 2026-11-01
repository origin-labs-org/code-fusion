
export interface SingleFeatureRolloutConfig {
  enabled: boolean;
  configVersion?: string;
}

export interface SingleFeatureRollout<T extends SingleFeatureRolloutConfig> {
  refresh(): Promise<T>;
  getSnapshot(): T;
  
  awaitFirstDecision(timeoutMs: number): Promise<T>;
}

export interface SingleFeatureRolloutLogger {
  info?: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export const SINGLE_FEATURE_REQUEST_TIMEOUT_MS = 3_000;
export const SINGLE_FEATURE_CACHE_TTL_MS = 60 * 60 * 1_000;

export interface CreateSingleFeatureRolloutOptions<T extends SingleFeatureRolloutConfig> {
  
  resolveConfig: (payload: unknown) => T | null;
  
  defaultValue: T;
  
  logTag: string;
  fetchConfig: (signal: AbortSignal) => Promise<unknown>;
  logger: SingleFeatureRolloutLogger;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

export function createSingleFeatureRollout<T extends SingleFeatureRolloutConfig>(
  options: CreateSingleFeatureRolloutOptions<T>,
): SingleFeatureRollout<T> {
  let snapshot: T = options.defaultValue;
  let snapshotExpiresAt = 0;
  let inFlight: Promise<T> | undefined;
  const timeoutMs = Math.max(options.timeoutMs ?? SINGLE_FEATURE_REQUEST_TIMEOUT_MS, 1);
  const cacheTtlMs = Math.max(options.cacheTtlMs ?? SINGLE_FEATURE_CACHE_TTL_MS, 1);

  const refresh = (): Promise<T> => {
    if (Date.now() < snapshotExpiresAt) {
      return Promise.resolve(snapshot);
    }
    if (inFlight) {
      return inFlight;
    }
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const request = (async () => {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error(`${options.logTag} config timed out after ${timeoutMs}ms`));
          }, timeoutMs);
          timeout.unref?.();
        });
        const payload = await Promise.race([
          options.fetchConfig(controller.signal),
          timeoutPromise,
        ]);
        const next = options.resolveConfig(payload);
        if (!next) {
          throw new Error(`${options.logTag} config is invalid`);
        }
        snapshot = next;
        snapshotExpiresAt = Date.now() + cacheTtlMs;
        options.logger.info?.(`[${options.logTag}] config refreshed`, {
          enabled: next.enabled,
          configVersion: next.configVersion,
        });
        return snapshot;
      } catch (error) {
        options.logger.warn(`[${options.logTag}] config unavailable, using cached decision`, {
          error,
          enabled: snapshot.enabled,
        });
        return snapshot;
      } finally {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        controller.abort();
      }
    })();
    inFlight = request;
    void request.then(
      () => {
        if (inFlight === request) {
          inFlight = undefined;
        }
      },
      () => {
        if (inFlight === request) {
          inFlight = undefined;
        }
      },
    );
    return request;
  };

  return {
    refresh,
    getSnapshot: () => snapshot,
    awaitFirstDecision: (timeoutMs: number) => {
      const boundedTimeout = Math.max(timeoutMs, 1);
      const fallback = new Promise<T>((resolve) => {
        const timer = setTimeout(() => resolve(snapshot), boundedTimeout);
        timer.unref?.();
      });
      return Promise.race([refresh(), fallback]);
    },
  };
}
