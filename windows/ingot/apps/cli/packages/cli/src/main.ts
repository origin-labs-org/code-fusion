import { STORAGE_MIGRATION_COMMAND } from "@origin-ai/cf-shared/sqlite-migrations";
import { interceptTuiStderr, isTuiInvocation } from "./tui-stderr.js";
import { interceptKnownRuntimeWarnings } from "./runtime-warnings.js";
import { installStderrConsoleBoundary } from "./protocol-console.js";
import { setCliProcessTitle } from "./process-name.js";
import { applyCliRuntimeEnvSanitization } from "./env.js";
import { ensureSeaRuntimeTools } from "./sea-runtime-tools.js";
import { isPluginHostInvocation, runPluginHostCommand } from "./plugin-host-command.js";
import { scheduleCliExitWatchdog } from "./shutdown.js";
import { installCliProcessErrorBoundary } from "./process-errors.js";
import { installProtocolStderrBoundary } from "./protocol-stderr.js";
import { createProtocolProcessLifecycle } from "./protocol-lifecycle.js";
import { isProtocolServerInvocation } from "./arguments.js";

void main();

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] !== STORAGE_MIGRATION_COMMAND && !argv.includes("--prepare-storage")) setCliProcessTitle();
  applyCliRuntimeEnvSanitization(process.env);
  const isProtocol = argv[0] === STORAGE_MIGRATION_COMMAND || isProtocolServerInvocation(argv);
  const isTui = isTuiInvocation(argv);
  if (isProtocol) installProtocolStderrBoundary(process.stderr);
  const lifecycle =
    isProtocol && argv[0] !== STORAGE_MIGRATION_COMMAND && !argv.includes("--prepare-storage")
      ? createProtocolProcessLifecycle()
      : undefined;
  const restoreConsole =
    isProtocol || isTui ? installStderrConsoleBoundary(process.stderr) : undefined;
  const runtimeWarnings = interceptKnownRuntimeWarnings(process.stderr);
  const tuiStderr = isTui ? interceptTuiStderr(process.stderr) : undefined;
  const stderr = tuiStderr?.passthrough ?? process.stderr;
  const disposeProcessErrorBoundary = isProtocol
    ? installCliProcessErrorBoundary({
        stderr,
        onFatal: (reason) => {
          if (lifecycle)
            lifecycle.requestShutdown(new Error("Uncaught process error", { cause: reason }));
          else process.exit(1);
        },
      })
    : undefined;

  try {
    if (argv[0] !== STORAGE_MIGRATION_COMMAND && !argv.includes("--prepare-storage"))
      Object.assign(process.env, await ensureSeaRuntimeTools());
    lifecycle?.signal.throwIfAborted();
    const context = {
      argv,
      stderr,
      stdin: process.stdin,
      stdout: process.stdout,
    };
    if (isPluginHostInvocation(argv)) {
      process.exitCode = await runPluginHostCommand(context, argv.slice(1));
      return;
    }
    if (argv[0] !== STORAGE_MIGRATION_COMMAND && !argv.includes("--prepare-storage")) {
      const { prepareCliProviderRuntimeEnv } = await import("./provider-runtime-env.js");
      Object.assign(
        process.env,
        await prepareCliProviderRuntimeEnv({
          argv,
          env: process.env,
        }),
      );
    }
    lifecycle?.signal.throwIfAborted();
    const { run } = await import("./run.js");
    lifecycle?.signal.throwIfAborted();
    const exitCode = await run(context, {
      protocolLifecycle: lifecycle,
      protocolInput: lifecycle?.input,
    });

    process.exitCode = exitCode;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await waitForPendingWarnings();
    if (lifecycle) {
      await lifecycle.complete(normalizeProcessExitCode(process.exitCode));
    } else {
      if (tuiStderr) {
        tuiStderr.restore();
      }
      runtimeWarnings.restore();
      disposeProcessErrorBoundary?.();
      const exitCode = normalizeProcessExitCode(process.exitCode);
      if (!isPluginHostInvocation(argv) || exitCode !== 0) {
        scheduleCliExitWatchdog({ exitCode });
      }
      restoreConsole?.();
    }
  }
}

function normalizeProcessExitCode(exitCode: string | number | null | undefined): number {
  if (typeof exitCode === "number" && Number.isInteger(exitCode)) return exitCode;
  if (typeof exitCode === "string") {
    const parsed = Number(exitCode);
    if (Number.isInteger(parsed)) return parsed;
  }
  return 0;
}

function waitForPendingWarnings(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
