import {
  normalizeRemoteArch,
  normalizeRemotePlatform,
  resolveRemotePlatform,
} from "@origin-ai/cf-server/remote/detectEnv.js";
import type { IRemoteBackend } from "@origin-ai/cf-server/remote/backend.js";
import { assertSupportedRemoteEnvironment } from "@origin-ai/cf-server/remote/remotePlatformSupport.js";
import {
  collectCommand,
  readLastJsonLine,
  readUniqueVersion,
  throwIfAborted,
} from "@origin-ai/cf-server/source-server/sourceServerTransportRuntime.js";
import type {
  SourceServerProbeOptions,
  SourceServerProbeResult,
  TransportContext,
} from "@origin-ai/cf-server/source-server/transportAdapter.js";

const SERVER_ROOT_SHELL = '"$HOME/.cf/server"';
const SERVER_BIN_SHELL = '"$HOME/.cf/server/bin/cf"';
const SERVER_CURRENT_SHELL = `${SERVER_ROOT_SHELL}/current.json`;
const SERVER_STATUS_SHELL = `${SERVER_ROOT_SHELL}/run/status.json`;
const SOURCE_SERVER_PROBE_MARKER_PREFIX = "__CF_PROBE_";

function buildSourceServerProbeCommand(includeReleaseIdentity: boolean): string {
  return [
    "set +e",
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}PLATFORM__\\n'`,
    "uname -s",
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}ARCH__\\n'`,
    "uname -m",
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}ROOT__\\n'`,
    `printf '%s\\n' ${SERVER_ROOT_SHELL}`,
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}KERNEL__\\n'`,
    "if [ -r /proc/sys/kernel/ostype ]; then cat /proc/sys/kernel/ostype; else printf '\\n'; fi",
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}LIBC__\\n'`,
    "getconf GNU_LIBC_VERSION 2>/dev/null",
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}INSTALLED__\\n'`,
    `if [ -f ${SERVER_BIN_SHELL} ]; then printf '1\\n'; else printf '0\\n'; fi`,
    ...(includeReleaseIdentity
      ? [
          `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}RELEASE__\\n'`,
          `if [ -r ${SERVER_CURRENT_SHELL} ]; then cat ${SERVER_CURRENT_SHELL}; fi`,
        ]
      : []),
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}VERSION__\\n'`,
    `if [ -r ${SERVER_CURRENT_SHELL} ]; then sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' ${SERVER_CURRENT_SHELL} | head -n 1; fi`,
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}STATUS__\\n'`,
    `if [ -r ${SERVER_STATUS_SHELL} ]; then status_pid=$(sed -n 's/^[[:space:]]*"pid"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' ${SERVER_STATUS_SHELL} | head -n 1); if [ -n "$status_pid" ] && kill -0 "$status_pid" 2>/dev/null; then tr -d '\\r\\n' < ${SERVER_STATUS_SHELL}; printf '\\n'; fi; fi`,
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}END__\\n'`,
  ].join("; ");
}

function readSourceServerProbeSections(output: string): Map<string, string> {
  const parts = output.split(/__CF_PROBE_([A-Z]+)__\r?\n/gu);
  const sections = new Map<string, string>();
  for (let index = 1; index + 1 < parts.length; index += 2) {
    sections.set(parts[index]!, parts[index + 1]!.trim());
  }
  return sections;
}

export class SourceServerProbeEnvironmentError extends Error {
  public override readonly name = "SourceServerProbeEnvironmentError";
}

const SOURCE_SERVER_MIN_GLIBC_VERSION = [2, 28] as const;

function assertSupportedGlibc(platform: string, libcText: string): void {
  if (platform !== "linux") return;
  const match = /^glibc\s+(\d+)\.(\d+)/iu.exec(libcText);
  if (!match) return;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const [minMajor, minMinor] = SOURCE_SERVER_MIN_GLIBC_VERSION;
  if (major > minMajor || (major === minMajor && minor >= minMinor)) return;
  const required = SOURCE_SERVER_MIN_GLIBC_VERSION.join(".");
  throw new SourceServerProbeEnvironmentError(
    `Remote glibc ${major}.${minor} is older than glibc ${required} required by CodeFusion Source Server. ` +
      `Use a Linux system with glibc ${required} or later, such as RHEL 8+, Ubuntu 20.04+ or Debian 10+.`,
  );
}

export async function probeSourceServer(
  backend: IRemoteBackend,
  context: TransportContext,
  options: SourceServerProbeOptions,
): Promise<SourceServerProbeResult> {
  throwIfAborted(context.signal);
  const result = await collectCommand(
    await backend.exec(buildSourceServerProbeCommand(options.includeReleaseIdentity === true)),
  );
  if (result.exitCode !== 0) {
    throw new SourceServerProbeEnvironmentError(
      result.stderr.trim() || "Source Server environment probe failed",
    );
  }
  const sections = readSourceServerProbeSections(result.stdout);
  const reportedPlatform = sections.get("PLATFORM") ?? "";
  const kernelOstype = sections.get("KERNEL") ?? "";
  const environment = {
    platform: resolveRemotePlatform(normalizeRemotePlatform(reportedPlatform), kernelOstype),
    arch: normalizeRemoteArch(sections.get("ARCH") ?? ""),
    ...(sections.get("ROOT") ? { installPath: sections.get("ROOT") } : {}),
  };
  try {
    assertSupportedRemoteEnvironment(environment);
  } catch (error) {
    throw new SourceServerProbeEnvironmentError(
      error instanceof Error ? error.message : String(error),
    );
  }
  assertSupportedGlibc(environment.platform, sections.get("LIBC") ?? "");
  const installed = sections.get("INSTALLED") === "1";
  if (!installed) return { ...environment, installed: false };

  let installedArchiveSha256: string | undefined;
  const releaseText = sections.get("RELEASE");
  if (releaseText) {
    try {
      const current = JSON.parse(releaseText) as { archiveSha256?: unknown };
      if (
        typeof current.archiveSha256 === "string" &&
        /^[a-f0-9]{64}$/iu.test(current.archiveSha256)
      ) {
        installedArchiveSha256 = current.archiveSha256.toLowerCase();
      }
    } catch (error) {
      context.onLog?.({
        phase: "probe",
        message: `Source Server release identity is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const versionText = sections.get("VERSION") ?? "";
  const statusText = sections.get("STATUS") ?? "";
  let installedVersion: string | undefined;
  let daemonStatus: SourceServerProbeResult["daemonStatus"];
  try {
    if (versionText) installedVersion = readUniqueVersion(versionText);
  } catch {
    installedVersion = undefined;
  }
  try {
    if (statusText) daemonStatus = readLastJsonLine(statusText) as typeof daemonStatus;
  } catch {
    daemonStatus = undefined;
  }
  return {
    ...environment,
    installed: true,
    ...(installedArchiveSha256 ? { installedArchiveSha256 } : {}),
    ...(installedVersion ? { installedVersion } : {}),
    ...(daemonStatus ? { daemonStatus } : {}),
  };
}
