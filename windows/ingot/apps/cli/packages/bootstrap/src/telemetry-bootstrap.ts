import { getCapturedCfAgentTelemetryEnv } from "@origin-ai/cf-shared";
import {
  prepareModelTelemetryEnv,
  shutdownPreparedModelTelemetry,
  type PrepareModelTelemetryOptions,
} from "@origin-ai/cf-telemetry";

export async function prepareCfTelemetryEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: PrepareModelTelemetryOptions = {},
): Promise<NodeJS.ProcessEnv> {
  const prepared = await prepareModelTelemetryEnv({
    ...getCapturedCfAgentTelemetryEnv(),
    ...env,
  }, {
    ...options,
    productVersion: options.productVersion ?? env.CF_APP_VERSION,
  });
  const deviceMid = prepared.CF_TELEMETRY_DEVICE_MID;
  return deviceMid ? { ...env, CF_TELEMETRY_DEVICE_MID: deviceMid } : env;
}

export async function shutdownCfTelemetry(): Promise<void> {
  await shutdownPreparedModelTelemetry();
}
