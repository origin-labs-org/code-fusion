import type { IRemoteBackend, StdioStream } from "@origin-ai/cf-server/remote/backend.js";
import { waitForClose } from "@origin-ai/cf-server/remote/deployShared.js";

export type RemoteDownloadTool = "curl" | "wget";
export type RemoteSha256Tool = "sha256sum" | "shasum" | "openssl";

export interface RemoteAssetTools {
  download: RemoteDownloadTool;
  tar: "tar";
  sha256: RemoteSha256Tool;
  supportsProgress?: boolean;
}

interface RemoteAssetPreflightLoggers {
  log: (...args: unknown[]) => void;
}

const REMOTE_TAR_MISSING_ERROR =
  "远端服务器缺少 tar，无法解压 CodeFusion Source Server。请安装 tar 后重试。";

export async function detectRemoteTarTool(
  backend: IRemoteBackend,
  loggers: RemoteAssetPreflightLoggers,
): Promise<"tar"> {
  loggers.log("[remote-assets] preflight: checking remote archive tools");
  const stream = await backend.exec(
    "tar_tool=; if command -v tar >/dev/null 2>&1; then tar_tool=tar; fi; printf 'tar=%s\\n' \"$tar_tool\"",
  );
  const stdoutPromise = collectStdout(stream);
  await waitForClose(stream);
  const values = parseToolLines(await stdoutPromise);
  if (values.tar !== "tar") throw new Error(REMOTE_TAR_MISSING_ERROR);
  return "tar";
}

export async function detectRemoteAssetTools(
  backend: IRemoteBackend,
  loggers: RemoteAssetPreflightLoggers,
): Promise<RemoteAssetTools> {
  loggers.log("[remote-assets] preflight: checking remote download tools");

  const stream = await backend.exec(buildPreflightCommand());
  const stdoutPromise = collectStdout(stream);
  await waitForClose(stream);
  const stdout = await stdoutPromise;

  const values = parseToolLines(stdout);
  const download = parseDownloadTool(values.download);
  const tar = values.tar === "tar" ? "tar" : null;
  const sha256 = parseSha256Tool(values.sha256);
  const supportsProgress = values.progress === "full";

  if (!download) {
    throw new Error(
      "The remote server is missing curl or wget and cannot directly download CodeFusion remote resources. Please install curl/wget, or switch back to \"Download locally, then upload\".",
    );
  }
  if (!tar) {
    throw new Error(REMOTE_TAR_MISSING_ERROR);
  }
  if (!sha256) {
    throw new Error(
      "The remote server is missing sha256sum, shasum, or openssl and cannot verify CodeFusion remote resources. Please install one of these verification tools, or switch back to \"Download locally, then upload\".",
    );
  }

  loggers.log(
    `[remote-assets] preflight: selected tools download=${download} tar=${tar} sha256=${sha256} progress=${supportsProgress ? "full" : "basic"}`,
  );

  return { download, tar, sha256, supportsProgress };
}

function buildPreflightCommand(): string {
  return [
    "download=",
    "if command -v curl >/dev/null 2>&1; then download=curl; elif command -v wget >/dev/null 2>&1; then download=wget; fi",
    "tar_tool=",
    "if command -v tar >/dev/null 2>&1; then tar_tool=tar; fi",
    "sha_tool=",
    "if command -v sha256sum >/dev/null 2>&1; then sha_tool=sha256sum; elif command -v shasum >/dev/null 2>&1; then sha_tool=shasum; elif command -v openssl >/dev/null 2>&1; then sha_tool=openssl; fi",
    "progress=basic",
    "if command -v awk >/dev/null 2>&1 && command -v wc >/dev/null 2>&1 && command -v date >/dev/null 2>&1 && command -v sleep >/dev/null 2>&1; then progress=full; fi",
    'printf \'download=%s\ntar=%s\nsha256=%s\nprogress=%s\n\' "$download" "$tar_tool" "$sha_tool" "$progress"',
  ].join("; ");
}

function parseToolLines(stdout: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    values[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1).trim();
  }
  return values;
}

function parseDownloadTool(value?: string): RemoteDownloadTool | null {
  return value === "curl" || value === "wget" ? value : null;
}

function parseSha256Tool(value?: string): RemoteSha256Tool | null {
  return value === "sha256sum" || value === "shasum" || value === "openssl" ? value : null;
}

async function collectStdout(stream: StdioStream): Promise<string> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    let closeFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const clearCloseFallback = () => {
      if (!closeFallbackTimer) {
        return;
      }
      clearTimeout(closeFallbackTimer);
      closeFallbackTimer = null;
    };
    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearCloseFallback();
      resolve(stdout);
    };
    const scheduleCloseFallback = () => {
      if (settled) {
        return;
      }
      clearCloseFallback();
      closeFallbackTimer = setTimeout(settle, 50);
    };

    stream.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (closeFallbackTimer) {
        scheduleCloseFallback();
      }
    });
    stream.stdout.on("end", settle);
    stream.stdout.on("close", settle);
    stream.stdout.on("error", settle);
    stream.onClose(scheduleCloseFallback);
  });
}
