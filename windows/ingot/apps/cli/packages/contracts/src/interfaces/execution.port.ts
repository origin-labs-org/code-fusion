import type { BackgroundBashOutputResult } from "@origin-ai/cf-shared";
// ============================================================
// Execution Port - subprocess execution boundary
// ============================================================

import type { ExecutionContext, TraceContext } from "../tracing/tracer.js";

export type ExecutionCommand =
  | {
      mode: "argv";
      file: string;
      args?: string[];
    }
  | {
      mode: "shell";
      command: string;
      shell?: true | string;
      /**
       * Internal Bash tool shell selection profile. This must not be exposed through hooks,
       * user config, or generic shell execution.
       */
      shellProfile?: "posix-bash";
      /**
       * CodeFusion runtime-provided Bash shell selection. Current consumers must only use
       * this when shellProfile === "posix-bash"; generic shell execution must ignore it.
       */
      shellOverride?: ExecutionShellSelection;
    };

export type ExecutionShellDialect = "cmd" | "posix" | "git-bash";

export type ExecutionShellSource = "auto-detected" | "user-config" | "legacy-fallback";

export interface ExecutionShellDisplay {
  /**
   * Stable provider-visible shell name. Never include absolute paths here.
   * Examples: "bash", "zsh", "Git Bash", "CMD", "system shell".
   */
  name: string;
}

export interface ExecutionShellSelection {
  /** Stable id from UI/settings or resolver-generated auto id. */
  id?: string;
  /** Human-readable diagnostic label. This can include more detail than display.name. */
  label?: string;
  /** Executable path when CodeFusion resolved a concrete shell. Omitted for legacy shell fallback. */
  path?: string;
  /** Shell syntax and cwd capture wrapper semantics. */
  dialect: ExecutionShellDialect | "legacy-shell";
  /** Why this selection exists. */
  source: ExecutionShellSource;
  /** Provider-visible stable name. */
  display: ExecutionShellDisplay;
}

export type ExecutionShellOverride = ExecutionShellSelection;

export type ExecutionEnvBase = "inherit" | "empty";

export interface ExecutionEnvOverlay {
  base?: ExecutionEnvBase;
  set?: Record<string, string>;
  unset?: string[];
}

interface EmbeddedSearchCommandBackend {
  /**
   * Execution strategy for Bash-level embedded find/grep/rg. This is deliberately
   * below provider-visible policy so the runtime can swap the implementation later.
   */
  command: string;
  args?: string[];
  
  env?: Record<string, string>;
}

export interface EmbeddedSearchInternalCliBackend extends EmbeddedSearchCommandBackend {
  kind: "internal-cli";
}

export interface EmbeddedSearchArgv0DispatchBackend extends EmbeddedSearchCommandBackend {
  kind: "argv0-dispatch";
}

export interface EmbeddedSearchNativeBinariesBackend {
  kind: "native-binaries";
  findCommand: string;
  grepCommand: string;
  rgCommand: string;
}

export type EmbeddedSearchBackend =
  | EmbeddedSearchInternalCliBackend
  | EmbeddedSearchArgv0DispatchBackend
  | EmbeddedSearchNativeBinariesBackend;

export interface ExecutionEmbeddedSearchPrelude {
  kind: "embedded-search";
  backend: EmbeddedSearchBackend;
  
  findAndGrepEnabled?: boolean;
}

export interface ExecutionSandboxPolicy {
  enabled: boolean;
  profile?: string;
  dangerouslyDisableSandbox?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ExecutionOutputLimit {
  maxInlineBytes?: number;
  maxBufferBytes?: number;
  
  persistOutput?: "none" | "on_truncate" | "always";
  
  maxPersistedBytes?: number;
  
  maxArtifactBytes?: number;
  
  killProcessOnPersistedLimit?: boolean;
}

export interface ExecutionRequest {
  command: ExecutionCommand;
  /** Normalized absolute cwd. Bash resolves omitted or relative cwd values from the session cwd. */
  cwd?: string;
  /**
   * Internal Bash prelude used by the Bash tool only. This must never be accepted from
   * user hooks or generic command runners.
   */
  bashPrelude?: ExecutionEmbeddedSearchPrelude;
  /**
   * Internal state capture. Defaults to false and must only be enabled by the Bash tool for
   * foreground executions. This must not be used for hooks or generic shell commands.
   */
  captureCwdAfterSuccess?: boolean;
  env?: ExecutionEnvOverlay;
  stdin?: string | Uint8Array;
  timeoutMs?: number;
  outputLimit?: ExecutionOutputLimit;
  sandbox?: ExecutionSandboxPolicy;
  trace?: TraceContext;
}

export type ExecutionStatus = "completed" | "failed" | "timed_out" | "cancelled" | "spawn_error";

export type ExecutionFailureType =
  | "spawn_error"
  | "timeout"
  | "cancelled"
  | "sandbox_violation"
  | "output_limit"
  | "unknown";

export interface ExecutionFailure {
  type: ExecutionFailureType;
  message: string;
  cause?: unknown;
}

export interface ExecutionStreamResult {
  text: string;
  bytes: number;
  truncated: boolean;
  artifactPath?: string;
  artifactBytes?: number;
  artifactTruncated?: boolean;
}

export interface ExecutionResult {
  status: ExecutionStatus;
  exitCode?: number;
  signal?: string;
  stdout: ExecutionStreamResult;
  stderr: ExecutionStreamResult;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  startedAt: Date;
  completedAt: Date;
  pid?: number;
  error?: ExecutionFailure;
  /** Internal runtime state captured after a successful command; never provider-visible output. */
  resolvedCwd?: string;
}

export interface ExecutionOutputPreview {
  text: string;
  fullText: string;
  totalLines: number;
  totalBytes: number;
  linesEstimated: boolean;
}

export type ExecutionEvent =
  | {
      type: "started";
      pid?: number;
      timestamp: Date;
    }
  | {
      type: "stdout" | "stderr";
      chunk: Uint8Array;
      text: string;
      timestamp: Date;
    }
  | {
      type: "progress";
      elapsedMs: number;
      pid?: number;
      stdoutBytes: number;
      stderrBytes: number;
      outputPreview?: ExecutionOutputPreview;
      stdoutTail?: string;
      stderrTail?: string;
      timestamp: Date;
    }
  | {
      type: "completed";
      result: ExecutionResult;
      timestamp: Date;
    }
  | {
      type: "failed";
      error: ExecutionFailure;
      timestamp: Date;
    };

export interface ExecutionRunOptions {
  signal?: AbortSignal;
  onEvent?: (event: ExecutionEvent) => void | Promise<void>;
  context?: ExecutionContext;
}

export type BackgroundExecutionStatus = "running" | ExecutionStatus;

export interface BackgroundExecutionStartResult {
  taskId: string;
  status: "running";
  startedAt: Date;
  pid?: number;
  outputPath?: string;
  stderrPersistedOutputPath?: string;
  stdoutPersistedOutputPath?: string;
}

export interface BackgroundExecutionSnapshot {
  taskId: string;
  status: BackgroundExecutionStatus;
  startedAt: Date;
  completedAt?: Date;
  pid?: number;
  stderrBytes?: number;
  stderrTail?: string;
  stdoutBytes?: number;
  stdoutTail?: string;
  outputPath?: string;
  stderrPersistedOutputPath?: string;
  stdoutPersistedOutputPath?: string;
  result?: ExecutionResult;
  error?: ExecutionFailure;
}

export interface ExecutionPort {
  run(request: ExecutionRequest, options?: ExecutionRunOptions): Promise<ExecutionResult>;
  start?(
    request: ExecutionRequest,
    options?: ExecutionRunOptions,
  ): Promise<BackgroundExecutionStartResult>;
  getBackgroundTask?(taskId: string): Promise<BackgroundExecutionSnapshot | undefined>;
  
  readBackgroundBashOutput?(taskId: string, sessionId: string): Promise<BackgroundBashOutputResult>;
  cancelBackgroundTask?(taskId: string): Promise<BackgroundExecutionSnapshot | undefined>;
  close?(): Promise<void>;
}
