import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resetCapturedCfAgentTelemetryEnvForTest,
  sanitizeCfRuntimeEnvInPlace,
} from "@origin-ai/cf-shared";
import { afterEach, describe, expect, it } from "vitest";
import { prepareCfTelemetryEnv } from "../src/telemetry-bootstrap.js";

describe("prepareCfTelemetryEnv", () => {
  afterEach(() => {
    resetCapturedCfAgentTelemetryEnvForTest();
  });

  it("从进程捕获区异步准备 identity，但不把 OTLP 凭据写回业务 env", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-bootstrap-telemetry-"));
    try {
      const env: NodeJS.ProcessEnv = {
        OTEL_EXPORTER_OTLP_HEADERS: "x-arms-license-key=secret",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://arms.example/v1/traces",
        CF_HOME: root,
      };
      sanitizeCfRuntimeEnvInPlace(env);

      const prepared = await prepareCfTelemetryEnv(env);

      expect(prepared.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
      expect(prepared.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBeUndefined();
      expect(prepared.CF_TELEMETRY_DEVICE_MID).toMatch(/^[0-9a-f-]{36}$/u);
      const state = JSON.parse(
        await readFile(join(root, "v2", "telemetry-state.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(state.deviceMid).toBe(prepared.CF_TELEMETRY_DEVICE_MID);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
