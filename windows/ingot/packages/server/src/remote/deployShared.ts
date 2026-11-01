import { join } from "node:path";
import { access } from "node:fs/promises";
import type { StdioStream } from "@origin-ai/cf-server/remote/backend.js";
import { quotePosixPathArg } from "@origin-ai/cf-server/remote/posixShell.js";
import type { RemoteAssetNetworkPort } from "@origin-ai/cf-server/remote/remoteAssetNetwork.js";

export const REMOTE_BASE = "~/.cf/server";

export interface RemoteAssetDeployOptions {
  
  signal?: AbortSignal;
  releaseDir?: string | null;
  resolveReleaseDir?: (
    componentIds?: string[],
    options?: { forceRefresh?: boolean },
  ) => Promise<string | null>;
  resolveComponentSha256?: (componentId: string) => Promise<string | null>;
  remoteCdnBaseUrl?: string;
  remoteCdnBaseUrls?: string[];
  remoteCacheDir?: string;
  manifestRequestTimeoutMs?: number;
  remoteAssetNetwork?: RemoteAssetNetworkPort;
}

export interface DeployLoggers {
  log: (...args: unknown[]) => void;
  logWarn: (...args: unknown[]) => void;
}

export async function fileExists(...pathParts: string[]): Promise<boolean> {
  const fullPath = join(...pathParts);
  try {
    await access(fullPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveFirstExistingPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function formatOptionalValue(value?: string): string {
  return value && value.trim().length > 0 ? value : "<empty>";
}

export function formatOptionalValues(values?: string[]): string {
  const normalizedValues = values?.map((value) => value.trim()).filter((value) => value.length > 0);
  return normalizedValues && normalizedValues.length > 0 ? normalizedValues.join(", ") : "<empty>";
}

export function buildRemoteMoveCommand(sourcePath: string, targetPath: string): string {
  return `command mv -f ${quotePosixPathArg(sourcePath)} ${quotePosixPathArg(targetPath)}`;
}

export function buildRemoteChmodExecutableCommand(filePath: string): string {
  return `command chmod +x ${quotePosixPathArg(filePath)}`;
}

export function buildRemoteExecutableReplaceCommand(
  sourcePath: string,
  targetPath: string,
): string {
  return `${buildRemoteChmodExecutableCommand(sourcePath)} && ${buildRemoteMoveCommand(sourcePath, targetPath)}`;
}

export function createRemoteAssetPlaceholderError(
  platformArch: string,
  options: RemoteAssetDeployOptions,
  resourceLabel: string,
): Error {
  return new Error(
    `[deploy] ${resourceLabel} missing for ${platformArch}. ` +
      `Development should read from mock-cdn/releases; production should download and cache remote assets from CDN ` +
      `(remoteCdnBaseUrl=${formatOptionalValue(options.remoteCdnBaseUrl)}, remoteCdnBaseUrls=${formatOptionalValues(options.remoteCdnBaseUrls)}, remoteCacheDir=${formatOptionalValue(options.remoteCacheDir)}).`,
  );
}

export function waitForClose(stream: StdioStream): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderrText = "";
    stream.stderr.on("data", (chunk: Buffer | string) => {
      if (stderrText.length >= 2048) {
        return;
      }
      stderrText += chunk.toString();
    });

    stream.onClose((code) => {
      if (code !== 0) {
        const stderrSummary = stderrText.trim();
        reject(
          new Error(
            stderrSummary.length > 0
              ? `[deploy] remote command failed with exit code ${code}: ${stderrSummary}`
              : `[deploy] remote command failed with exit code ${code}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}
