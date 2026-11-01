import { ensureTelemetryDeviceMid } from "@origin-ai/cf-services/node";

export interface EnsureRemoteServerDeviceMidOptions {
  
  ensureDeviceMid?: () => Promise<string>;
  log: (...args: unknown[]) => void;
}

export async function ensureRemoteServerDeviceMid(
  options: EnsureRemoteServerDeviceMidOptions,
): Promise<string | undefined> {
  const ensureDeviceMid = options.ensureDeviceMid ?? ensureTelemetryDeviceMid;
  try {
    return await ensureDeviceMid();
  } catch (error) {
    options.log(
      "telemetry deviceMid 初始化失败，CodeFusion endpoint 请求将不带 X-Device-Mid:",
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
}
