import { createHash } from "node:crypto";

export interface BuildAgentTelemetrySpawnEnvInput {
  telemetryEnv: Record<string, string>;
  deviceMid?: string;
  userId?: string;
  runtimeSurface: "desktop_local_host" | "remote_workspace_host";
}

export function buildAgentTelemetrySpawnEnv(
  input: BuildAgentTelemetrySpawnEnvInput,
): Record<string, string> {
  if (
    !input.telemetryEnv.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT &&
    !input.telemetryEnv.OTEL_EXPORTER_OTLP_ENDPOINT
  ) {
    return {};
  }
  const deviceMid = input.deviceMid?.trim();
  const userId = input.userId?.trim();
  return {
    ...input.telemetryEnv,
    ...(deviceMid ? { CF_TELEMETRY_DEVICE_MID: deviceMid } : {}),
    ...(userId
      ? {
          CF_TELEMETRY_IDENTITY_STATE: "authenticated",
          CF_TELEMETRY_USER_SUBJECT_ID: createHash("sha256")
            .update(userId)
            .digest("hex"),
        }
      : {
          CF_TELEMETRY_IDENTITY_STATE: deviceMid ? "anonymous" : "unknown",
        }),
    CF_TELEMETRY_RUNTIME_SURFACE: input.runtimeSurface,
  };
}
