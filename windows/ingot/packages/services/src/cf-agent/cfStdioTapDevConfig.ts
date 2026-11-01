import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CfStdioTapDevState } from "@origin-ai/cf-shared";
import { getAppConfigDir } from "#src/paths.js";
import { isEffectiveDevelopmentNodeEnv } from "#src/runtime-tools/nodeEnv.js";

interface CfStdioTapStateFile {
  enabled?: boolean;
}

export function isCfStdioTapDevVisible(): boolean {
  return isEffectiveDevelopmentNodeEnv();
}

export function getCfStdioTapDevDir(): string {
  return join(getAppConfigDir(), "dev");
}

export function getCfStdioTapDevLogDir(): string {
  return join(getCfStdioTapDevDir(), "stdio-traffic");
}

export function getCfStdioTapDevStatePath(): string {
  return join(getCfStdioTapDevDir(), "cf-stdio-tap.json");
}

function readStateFile(path: string): CfStdioTapStateFile {
  if (!existsSync(path)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as CfStdioTapStateFile) : {};
  } catch {
    return {};
  }
}

export function readCfStdioTapDevState(): CfStdioTapDevState {
  const visible = isCfStdioTapDevVisible();
  const statePath = getCfStdioTapDevStatePath();
  const fileState = readStateFile(statePath);
  return {
    enabled: visible && fileState.enabled === true,
    visible,
    logDir: getCfStdioTapDevLogDir(),
    statePath,
  };
}

export function setCfStdioTapDevEnabled(enabled: boolean): CfStdioTapDevState {
  const visible = isCfStdioTapDevVisible();
  const statePath = getCfStdioTapDevStatePath();
  mkdirSync(getCfStdioTapDevDir(), { recursive: true });
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        enabled: visible && enabled,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return readCfStdioTapDevState();
}
