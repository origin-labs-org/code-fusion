import {
  createMemorySampleWriteGate,
  formatMemorySampleLine,
  MEMORY_SAMPLE_INTERVAL_MS,
  memoryUsageToSampleFields,
  type MemorySample,
} from "@origin-ai/cf-shared";

interface HostMemoryDiagnosticsLogger {
  info(...args: unknown[]): void;
}

interface HostMemoryDiagnosticsTimerHandle {
  unref?(): void;
}

export interface StartHostMemoryDiagnosticsLogOptions {
  logger: HostMemoryDiagnosticsLogger;
  
  collectCounters(): Record<string, number>;
  readMemoryUsage?: () => NodeJS.MemoryUsage;
  
  onMemoryUsage?: (memoryUsage: NodeJS.MemoryUsage) => void;
  now?: () => number;
  intervalMs?: number;
  timer?: {
    setInterval(callback: () => void, intervalMs: number): HostMemoryDiagnosticsTimerHandle;
    clearInterval(handle: HostMemoryDiagnosticsTimerHandle): void;
  };
}

export interface HostMemoryDiagnosticsLog {
  
  sampleNow(): boolean;
  stop(): void;
}

export function startHostMemoryDiagnosticsLog(
  options: StartHostMemoryDiagnosticsLogOptions,
): HostMemoryDiagnosticsLog {
  const readMemoryUsage = options.readMemoryUsage ?? (() => process.memoryUsage());
  const now = options.now ?? (() => Date.now());
  const timer = options.timer ?? {
    setInterval: (callback: () => void, intervalMs: number) => setInterval(callback, intervalMs),
    clearInterval: (handle: HostMemoryDiagnosticsTimerHandle) =>
      clearInterval(handle as ReturnType<typeof setInterval>),
  };
  const gate = createMemorySampleWriteGate();

  const sampleNow = (): boolean => {
    let memoryUsage: NodeJS.MemoryUsage;
    try {
      memoryUsage = readMemoryUsage();
    } catch {
      return false;
    }

    try {
      options.onMemoryUsage?.(memoryUsage);
    } catch {
    }

    try {
      const sample: MemorySample = {
        role: "utility_host",
        ...memoryUsageToSampleFields(memoryUsage),
        counters: options.collectCounters(),
      };
      const reason = gate.evaluate(sample, now());
      if (!reason) {
        return false;
      }
      options.logger.info(formatMemorySampleLine(sample, reason));
      return true;
    } catch {
      return false;
    }
  };

  let handle: HostMemoryDiagnosticsTimerHandle | undefined = timer.setInterval(
    sampleNow,
    options.intervalMs ?? MEMORY_SAMPLE_INTERVAL_MS,
  );
  try {
    handle.unref?.();
  } catch {
  }

  return {
    sampleNow,
    stop() {
      if (!handle) {
        return;
      }
      const current = handle;
      handle = undefined;
      timer.clearInterval(current);
    },
  };
}
