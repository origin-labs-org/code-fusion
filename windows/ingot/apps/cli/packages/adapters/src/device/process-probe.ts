import { readdir, readFile } from "node:fs/promises";
import { readDarwinProcessGroup, readDarwinProcessTable } from "./process-probe-darwin.js";
import {
  sampleLinuxProcessGroup,
  sampleLinuxProcessTrees,
  type LinuxProcReaders,
} from "./process-probe-linux.js";
import {
  defaultProbeExecFile,
  groupProcessTrees,
  isSamplablePid,
  toSample,
  PROCESS_PROBE_SAMPLE_TIMEOUT_MS,
  type ProcessProbeExecFile,
  type ProcessProbeSample,
} from "./process-probe-shared.js";
import { readWindowsProcessMemory } from "./process-probe-windows.js";

export {
  PROCESS_PROBE_SAMPLE_TIMEOUT_MS,
  type ProcessProbeCommandResult,
  type ProcessProbeExecFile,
  type ProcessProbeSample,
} from "./process-probe-shared.js";

export type ProcessTreeScope = "direct_process" | "process_tree";

export interface ProcessProbe {
  
  sampleProcessTrees(
    rootPids: readonly number[],
  ): Promise<ReadonlyMap<number, readonly ProcessProbeSample[]> | undefined>;
  
  sampleProcessGroup(processGroupId: number): Promise<readonly ProcessProbeSample[] | undefined>;
  
  reset(): void;
  
  readonly treeScope: ProcessTreeScope;
}

export interface CreateProcessProbeOptions {
  execFile?: ProcessProbeExecFile;
  
  listProcDirectory?: () => Promise<readonly string[]>;
  
  onSampleFailed?: (reason: string) => void;
  platform?: NodeJS.Platform;
  
  readProcFile?: (path: string) => Promise<string>;
}

export const PROCESS_PROBE_MAX_CONSECUTIVE_FAILURES = 3;

const PROBE_TIMED_OUT = Symbol("process-probe-timed-out");

export function createProcessProbe(options: CreateProcessProbeOptions = {}): ProcessProbe {
  const platform = options.platform ?? process.platform;
  const execFile = options.execFile ?? defaultProbeExecFile;
  const listProcDirectory = options.listProcDirectory ?? (() => readdir("/proc"));
  const readProcFile = options.readProcFile ?? ((path: string) => readFile(path, "utf8"));
  let consecutiveFailures = 0;

  const reportFailure = (reason: string): undefined => {
    consecutiveFailures += 1;
    try {
      options.onSampleFailed?.(reason);
    } catch {
    }
    return undefined;
  };

  
  const sampleWithinBudget = async <T>(
    collect: (readers: LinuxProcReaders) => Promise<T>,
  ): Promise<T | undefined> => {
    if (consecutiveFailures >= PROCESS_PROBE_MAX_CONSECUTIVE_FAILURES) return undefined;
    const deadline = Date.now() + PROCESS_PROBE_SAMPLE_TIMEOUT_MS;
    let outcome: T | typeof PROBE_TIMED_OUT;
    try {
      outcome = await raceProbeTimeout(
        collect({
          isExpired: () => Date.now() >= deadline,
          listProcDirectory,
          readProcFile,
        }),
      );
    } catch (error) {
      return reportFailure(error instanceof Error ? error.message : String(error));
    }
    if (outcome === PROBE_TIMED_OUT) {
      return reportFailure(`采样超过 ${PROCESS_PROBE_SAMPLE_TIMEOUT_MS} 毫秒`);
    }
    consecutiveFailures = 0;
    return outcome;
  };

  return {
    treeScope: platform === "win32" ? "direct_process" : "process_tree",
    async sampleProcessTrees(rootPids) {
      const roots = [...new Set(rootPids.filter(isSamplablePid))];
      if (roots.length === 0) return new Map();
      if (platform === "win32") {
        const samples = await sampleWithinBudget(() => readWindowsProcessMemory(execFile, roots));
        if (!samples) return undefined;
        return new Map(samples.map((sample) => [sample.pid, [sample]]));
      }
      return await sampleWithinBudget(async (readers) =>
        platform === "linux"
          ? await sampleLinuxProcessTrees(readers, roots)
          : groupProcessTrees(await readDarwinProcessTable(execFile), roots),
      );
    },
    async sampleProcessGroup(processGroupId) {
      if (!isSamplablePid(processGroupId)) return undefined;
      if (platform === "win32") return undefined;
      return await sampleWithinBudget(async (readers) =>
        platform === "linux"
          ? await sampleLinuxProcessGroup(readers, processGroupId)
          : (await readDarwinProcessGroup(execFile, processGroupId)).map(toSample),
      );
    },
    reset() {
      consecutiveFailures = 0;
    },
  };
}

async function raceProbeTimeout<T>(work: Promise<T>): Promise<T | typeof PROBE_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof PROBE_TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(PROBE_TIMED_OUT), PROCESS_PROBE_SAMPLE_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
