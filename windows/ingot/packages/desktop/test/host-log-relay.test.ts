import { describe, expect, it, vi } from "vitest";
import { createHostLogRelay } from "../src/main/hostLogRelay.js";

function createLoggerSpy() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("host log relay", () => {
  it("Replay buffered stdout/stderr on exit before structured logs are received", () => {
    const logger = createLoggerSpy();
    const relay = createHostLogRelay("local-1", logger);

    relay.onStdout("boot stdout");
    relay.onStderr("boot stderr");

    relay.flushRawLogs();

    expect(logger.info).toHaveBeenCalledWith("[host-stdout] (local-1):", "boot stdout");
    expect(logger.error).toHaveBeenCalledWith("[host-stderr] (local-1):", "boot stderr");
  });

  it("Before structured logs are received, replay Node warning stderr fallbacks as warn", () => {
    const logger = createLoggerSpy();
    const relay = createHostLogRelay("remote-1", logger);

    relay.onStderr(
      "(node:37541) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n(Use `Electron Helper --trace-warnings ...` to show where the warning was created)",
    );

    relay.flushRawLogs();

    expect(logger.warn).toHaveBeenCalledWith(
      "[host-stderr] (remote-1):",
      "(node:37541) ExperimentalWarning: SQLite is an experimental feature and might change at any time",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("Discard cached raw stream after receiving structured logs to avoid duplicate writes", () => {
    const logger = createLoggerSpy();
    const relay = createHostLogRelay("local-1", logger);

    relay.onStdout("boot stdout");
    relay.onStructuredLog({
      level: "info",
      source: "host",
      message: "[cf-host] initializing local services",
    });
    relay.onStderr("late stderr");
    relay.flushRawLogs();

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "[host-log] (local-1) [host] [cf-host] initializing local services",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});
