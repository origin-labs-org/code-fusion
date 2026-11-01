import { mkdirSync, readFileSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gitBashPathToWindowsPath,
  type ExecutionCommand,
  type ExecutionRequest,
  type ExecutionShellDialect,
  windowsPathToGitBashPath,
} from "@origin-ai/cf-contracts";

export interface CwdCapturePlan {
  command: ExecutionCommand;
  cwdFilePath?: string;
}

export function createCwdCapturePlan(
  request: ExecutionRequest,
  options: {
    dialect: ExecutionShellDialect;
    platform: NodeJS.Platform;
  },
): CwdCapturePlan {
  if (request.captureCwdAfterSuccess !== true || request.command.mode !== "shell") {
    return { command: request.command };
  }

  const cwdCaptureDir = tmpdir();
  mkdirSync(cwdCaptureDir, { recursive: true });
  const cwdFilePath = join(cwdCaptureDir, `cf-${crypto.randomUUID()}-cwd`);

  const wrappedCommand =
    options.dialect === "cmd"
      ? createWindowsCmdCwdCaptureCommand(request.command.command, cwdFilePath)
      : createPosixCwdCaptureCommand(
          request.command.command,
          options.dialect === "git-bash" ? windowsPathToGitBashPath(cwdFilePath) : cwdFilePath,
        );

  return {
    command: {
      ...request.command,
      command: wrappedCommand,
    },
    cwdFilePath,
  };
}

function createPosixCwdCaptureCommand(command: string, cwdFilePath: string): string {
  return [
    command,
    "__cf_status=$?",
    `if [ "$__cf_status" -eq 0 ]; then pwd -P > ${shellQuote(cwdFilePath)}; fi`,
    'exit "$__cf_status"',
  ].join("\n");
}

function createWindowsCmdCwdCaptureCommand(command: string, cwdFilePath: string): string {
  return [
    command,
    'set "__cf_status=%ERRORLEVEL%"',
    `if "%__cf_status%"=="0" cd > ${cmdQuote(cwdFilePath)}`,
    "exit /b %__cf_status%",
  ].join("\r\n");
}

export function readCapturedCwd(
  cwdFilePath: string | undefined,
  options: { dialect: ExecutionShellDialect },
): string | undefined {
  if (!cwdFilePath) return undefined;
  try {
    const value = readFileSync(cwdFilePath, "utf8").replace(/\r?\n$/u, "");
    if (!value) return undefined;
    const hostValue = normalizeCapturedCwdForHost(value, options.dialect);
    const stats = statSync(hostValue);
    if (!stats.isDirectory()) return undefined;
    return realpathSync(hostValue);
  } catch {
    return undefined;
  } finally {
    try {
      unlinkSync(cwdFilePath);
    } catch {
    }
  }
}

export function normalizeCapturedCwdForHost(
  value: string,
  dialect: ExecutionShellDialect,
): string {
  return dialect === "git-bash" ? gitBashPathToWindowsPath(value) : value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function cmdQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
