import { describe, expect, it } from "vitest";
import {
  CF_TOOL_ENV_PASSTHROUGH_ENV_KEY,
  CF_REMOTE_HTTP_PROXY_ENV_KEY,
  CF_REMOTE_NO_PROXY_ENV_KEY,
  CF_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY,
  buildCfToolEnvPassthroughEnv,
  getCapturedCfCuaBrokerCredentials,
  isCuaDevModeRequested,
  isCfCuaInternalFeatureEnabled,
  readCfAgentTelemetryEnv,
  readCfToolEnvPassthroughEnv,
  resetCapturedCfCuaBrokerCredentialsForTest,
  sanitizeCfRuntimeEnv,
  getCapturedCfAgentTelemetryEnv,
  resetCapturedCfAgentTelemetryEnvForTest,
} from "../src/runtimeEnv.js";

describe("runtimeEnv", () => {
  it("enables internal CUA by default while honoring explicit false values", () => {
    expect(isCfCuaInternalFeatureEnabled({})).toBe(true);
    expect(isCfCuaInternalFeatureEnabled({ CF_CUA_PRODUCT_HELPER: "0" })).toBe(false);
    expect(isCfCuaInternalFeatureEnabled({ CF_CUA_PRODUCT_HELPER: "false" })).toBe(false);
    expect(isCfCuaInternalFeatureEnabled({ CF_CUA_PRODUCT_HELPER: "1" })).toBe(true);
    expect(isCfCuaInternalFeatureEnabled({ CF_CUA_PRODUCT_HELPER: " TRUE " })).toBe(true);
    expect(isCfCuaInternalFeatureEnabled({ CF_CUA_PRODUCT_HELPER: "on" })).toBe(true);
  });

  it("parses explicit truthy values for CF_CUA_DEV_MODE", () => {
    // isCuaDevModeRequested: only explicit truthy values (case-insensitive, trimmed).
    expect(isCuaDevModeRequested({})).toBe(false);
    expect(isCuaDevModeRequested({ CF_CUA_DEV_MODE: "0" })).toBe(false);
    expect(isCuaDevModeRequested({ CF_CUA_DEV_MODE: "false" })).toBe(false);
    expect(isCuaDevModeRequested({ CF_CUA_DEV_MODE: "1" })).toBe(true);
    expect(isCuaDevModeRequested({ CF_CUA_DEV_MODE: " ON " })).toBe(true);
    expect(isCuaDevModeRequested({ CF_CUA_DEV_MODE: "true" })).toBe(true);
  });

  it("sanitizes runtime env while sealing user network env for tools", () => {
    const sourceEnv = {
      HTTP_PROXY: "http://proxy.example:8080",
      NODE_ENV: "development",
      NODE_EXTRA_CA_CERTS: "/tmp/root-ca.pem",
      PATH: "/usr/bin:/bin",
      npm_config_proxy: "http://npm-proxy.example:8080",
    };

    const sanitized = sanitizeCfRuntimeEnv(sourceEnv);
    const passthroughEnv = buildCfToolEnvPassthroughEnv(sourceEnv);
    const captured = readCfToolEnvPassthroughEnv(passthroughEnv);

    expect(sanitized).toEqual({ PATH: "/usr/bin:/bin" });
    expect(captured).toEqual({
      HTTP_PROXY: "http://proxy.example:8080",
      NODE_EXTRA_CA_CERTS: "/tmp/root-ca.pem",
      npm_config_proxy: "http://npm-proxy.example:8080",
    });
  });

  it("ignores invalid passthrough JSON and non-network keys", () => {
    const captured = readCfToolEnvPassthroughEnv({
      [CF_TOOL_ENV_PASSTHROUGH_ENV_KEY]: JSON.stringify({
        HTTP_PROXY: "http://proxy.example:8080",
        NODE_ENV: "production",
        PATH: "/tmp/bin",
      }),
    });

    expect(captured).toEqual({
      HTTP_PROXY: "http://proxy.example:8080",
    });
    expect(
      readCfToolEnvPassthroughEnv({
        [CF_TOOL_ENV_PASSTHROUGH_ENV_KEY]: "not-json",
      }),
    ).toEqual({});
  });

  it("strips the CUA broker socket/authority/refresh marker from child env and tool passthrough", () => {
    const sourceEnv = {
      PATH: "/usr/bin:/bin",
      CF_CUA_PERMISSION_BROKER_SOCKET: "/tmp/cf-cua-me/broker-abc.sock",
      CF_CUA_PERMISSION_BROKER_REFRESH_MARKER:
        "/tmp/cf-cua-me/broker-abc.sock.permission-refresh.json",
    };
    const sanitized = sanitizeCfRuntimeEnv(sourceEnv);
    expect(sanitized).toEqual({ PATH: "/usr/bin:/bin" });

    const captured = readCfToolEnvPassthroughEnv(buildCfToolEnvPassthroughEnv(sourceEnv));
    expect(captured).not.toHaveProperty("CF_CUA_PERMISSION_BROKER_SOCKET");
    expect(captured).not.toHaveProperty("CF_CUA_PERMISSION_BROKER_REFRESH_MARKER");
  });

  it("strips desktop-to-remote network handoff values after stdio bootstrap", () => {
    const sourceEnv = {
      PATH: "/usr/bin:/bin",
      [CF_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY]: "1",
      [CF_REMOTE_HTTP_PROXY_ENV_KEY]: "http://172.21.240.1:7890",
      [CF_REMOTE_NO_PROXY_ENV_KEY]: "localhost,127.0.0.1",
    };

    expect(sanitizeCfRuntimeEnv(sourceEnv)).toEqual({ PATH: "/usr/bin:/bin" });
    expect(readCfToolEnvPassthroughEnv(buildCfToolEnvPassthroughEnv(sourceEnv))).toEqual({});
  });

  it("captures broker credentials as one atomic pair and clears stale state on partial rotation", () => {
    resetCapturedCfCuaBrokerCredentialsForTest();
    try {
      sanitizeCfRuntimeEnv({
        CF_CUA_PERMISSION_BROKER_SOCKET: "/tmp/broker-a.sock",
        CF_CUA_PLUGIN_AUTHORITY: "authority-a",
      });
      expect(getCapturedCfCuaBrokerCredentials()).toEqual({
        socket: "/tmp/broker-a.sock",
        pluginAuthority: "authority-a",
      });

      sanitizeCfRuntimeEnv({
        CF_CUA_PERMISSION_BROKER_SOCKET: "/tmp/broker-b.sock",
      });
      expect(getCapturedCfCuaBrokerCredentials()).toEqual({
        socket: undefined,
        pluginAuthority: undefined,
      });

      sanitizeCfRuntimeEnv({
        CF_CUA_PERMISSION_BROKER_SOCKET: "/tmp/broker-b.sock",
        CF_CUA_PLUGIN_AUTHORITY: "authority-b",
      });
      expect(getCapturedCfCuaBrokerCredentials()).toEqual({
        socket: "/tmp/broker-b.sock",
        pluginAuthority: "authority-b",
      });
    } finally {
      resetCapturedCfCuaBrokerCredentialsForTest();
    }
  });

  it("captures Agent OTLP config privately and never passes auth or identity through to tools", () => {
    resetCapturedCfAgentTelemetryEnvForTest();
    const sourceEnv = {
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://arms.example.com/v1/traces",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "Authorization=secret",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://arms.example.com/v1/metrics",
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: "Authorization=metric-secret",
      PATH: "/usr/bin:/bin",
      CF_TELEMETRY_USER_SUBJECT_ID: "opaque-user",
    };
    expect(sanitizeCfRuntimeEnv(sourceEnv)).toEqual({ PATH: "/usr/bin:/bin" });
    expect(getCapturedCfAgentTelemetryEnv()).toMatchObject({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://arms.example.com/v1/traces",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "Authorization=secret",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://arms.example.com/v1/metrics",
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: "Authorization=metric-secret",
      CF_TELEMETRY_USER_SUBJECT_ID: "opaque-user",
    });
    const toolEnv = readCfToolEnvPassthroughEnv(buildCfToolEnvPassthroughEnv(sourceEnv));
    expect(toolEnv).not.toHaveProperty("OTEL_EXPORTER_OTLP_TRACES_HEADERS");
    expect(toolEnv).not.toHaveProperty("OTEL_EXPORTER_OTLP_METRICS_HEADERS");
    expect(toolEnv).not.toHaveProperty("CF_TELEMETRY_USER_SUBJECT_ID");
  });

  it("extracts only the allowlisted Agent telemetry env", () => {
    expect(
      readCfAgentTelemetryEnv({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: " https://arms.example.com/v1/traces ",
        OTEL_UNKNOWN_SECRET: "must-not-pass",
        PATH: "/bin",
        CF_MODEL_TELEMETRY_ENABLED: "1",
        CF_TELEMETRY_RUNTIME_DISTRIBUTION: " packaged ",
      }),
    ).toEqual({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://arms.example.com/v1/traces",
      CF_MODEL_TELEMETRY_ENABLED: "1",
      CF_TELEMETRY_RUNTIME_DISTRIBUTION: "packaged",
    });
  });
});
