import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

describe("telemetry service registration", () => {
  beforeAll(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);

    const originalEmitWarning = process.emitWarning;
    vi.spyOn(process, "emitWarning").mockImplementation(((...args: unknown[]) => {
      const [warning, second] = args;
      const message = warning instanceof Error ? warning.message : String(warning);
      const warningType =
        typeof second === "string"
          ? second
          : typeof second === "object" && second !== null && "type" in second
            ? String((second as { type?: unknown }).type)
            : undefined;

      if (warningType === "ExperimentalWarning" && message.includes("SQLite")) {
        return;
      }

      return (originalEmitWarning as (...warningArgs: unknown[]) => void).apply(process, args);
    }) as typeof process.emitWarning);
  });

  it("does not register app-level telemetry in local services", async () => {
    const [{ createLocalServices }, { createServiceDescriptor }] = await Promise.all([
      import("../src/node.js"),
      import("../src/descriptors.js"),
    ]);

    const services = createLocalServices({
      cfBuiltinProviderConfigFilePath: resolve(
        import.meta.dirname,
        "../../../config/provider/cf-builtin.json",
      ),
    });
    const telemetryDescriptor = createServiceDescriptor<{
      reportAppLaunch: unknown;
      reportAppDailyActive: unknown;
    }>("telemetry");
    expect(() => services.get(telemetryDescriptor)).toThrow("Service not registered: telemetry");
  });
});
