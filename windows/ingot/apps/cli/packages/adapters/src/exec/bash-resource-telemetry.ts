import { randomUUID } from "node:crypto";
import { freemem } from "node:os";
import {
  BASH_RESOURCE_MAX_SAMPLES,
  BASH_RESOURCE_SAMPLE_INTERVAL_MS,
  type CfToolExecResource,
} from "@origin-ai/cf-shared";
import { createProcessProbe, type ProcessProbe } from "../device/process-probe.js";

import { subscribeBashOutputProgress } from "./bash-progress-poller.js";
import { DEFAULT_PROGRESS_INTERVAL_MS } from "./execution-utils.js";

const BYTES_PER_KB = 1024;

interface BashResourceTelemetryOptions {
  processGroupId?: number;
  platform?: NodeJS.Platform;
  probe?: Pick<ProcessProbe, "sampleProcessGroup">;
  onComplete: (sample: CfToolExecResource) => void;
  readContext?: () => Pick<CfToolExecResource, "cliRssKb" | "systemFreeMemoryKb">;
}

export function createBashResourceTelemetry(options: BashResourceTelemetryOptions): {
  finish(exitKind: CfToolExecResource["exitKind"]): void;
} {
  const platform = options.platform ?? process.platform;
  const startedAt = performance.now();
  const probe = options.probe ?? createProcessProbe({ platform });
  const cpuByPid = new Map<number, number>();
  let finished = false;
  let lastSampleElapsedMs = 0;
  let attempts = 0;
  let sampleCount = 0;
  let treeRssKbPeak = 0;
  let treeCpuTimeMs = 0;
  let unsubscribe: (() => void) | undefined;

  const sample = async () => {
    const elapsedMs = performance.now() - startedAt;
    if (finished || elapsedMs - lastSampleElapsedMs < BASH_RESOURCE_SAMPLE_INTERVAL_MS) return;
    lastSampleElapsedMs = elapsedMs;
    attempts += 1;
    try {
      const rows = await probe.sampleProcessGroup(options.processGroupId!);
      if (finished || !rows?.length) return;
      sampleCount += 1;
      let rssKb = 0;
      for (const row of rows) {
        rssKb += row.rssKb;
        if (row.cpuTimeMs === undefined) continue;
        const previous = cpuByPid.get(row.pid) ?? 0;
        treeCpuTimeMs += Math.max(0, row.cpuTimeMs - previous);
        cpuByPid.set(row.pid, row.cpuTimeMs);
      }
      treeRssKbPeak = Math.max(treeRssKbPeak, rssKb);
    } catch {
    } finally {
      if (attempts === BASH_RESOURCE_MAX_SAMPLES) unsubscribe?.();
    }
  };
  if (platform !== "win32" && options.processGroupId !== undefined) {
    unsubscribe = subscribeBashOutputProgress(DEFAULT_PROGRESS_INTERVAL_MS, sample);
  }

  return {
    finish(exitKind) {
      if (finished) return;
      finished = true;
      unsubscribe?.();
      cpuByPid.clear();
      const durationMs = performance.now() - startedAt;
      if (durationMs < BASH_RESOURCE_SAMPLE_INTERVAL_MS) return;
      try {
        const context = options.readContext?.() ?? {
          cliRssKb: process.memoryUsage.rss() / BYTES_PER_KB,
          systemFreeMemoryKb: freemem() / BYTES_PER_KB,
        };
        options.onComplete({
          completionToken: randomUUID(),
          platform,
          toolName: "bash",
          durationMs,
          exitKind,
          sampleCount,
          ...context,
          ...(platform === "win32" ? {} : { treeRssKbPeak, treeCpuTimeMs }),
        });
      } catch {
      }
    },
  };
}
