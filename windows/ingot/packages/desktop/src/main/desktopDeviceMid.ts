import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { createUuid } from "@origin-ai/cf-shared";
import { getAppConfigDir } from "@origin-ai/cf-services/node";

export interface EnsureDesktopDeviceMidSyncOptions {
  
  configDir?: string;
  
  createId?: () => string;
}

export function ensureDesktopDeviceMidSync(
  options?: EnsureDesktopDeviceMidSyncOptions,
): string {
  const createId = options?.createId ?? createUuid;
  try {
    const configDir = options?.configDir ?? getAppConfigDir();
    const stateFile = join(configDir, "telemetry-state.json");

    const state = readTelemetryStateSync(stateFile);
    if (typeof state.deviceMid === "string" && state.deviceMid) {
      return state.deviceMid;
    }

    const deviceMid = createId();
    state.deviceMid = deviceMid;
    writeTelemetryStateSync(stateFile, state);
    return deviceMid;
  } catch {
    return createId();
  }
}

function readTelemetryStateSync(stateFile: string): Record<string, unknown> {
  try {
    const raw = readFileSync(stateFile, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeTelemetryStateSync(
  stateFile: string,
  state: Record<string, unknown>,
): void {
  const dir = dirname(stateFile);
  mkdirSync(dir, { recursive: true });
  const tempFile = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(tempFile, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tempFile, stateFile);
}
