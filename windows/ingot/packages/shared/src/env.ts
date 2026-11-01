import type { CfRuntimeEnv } from "./runtimeEnv.js";

export type CfEnv = "test" | "production";

export type CfProductFlavor = "production" | "preview";
export type ArmsRumEnv = "local" | "prod";

declare const __CF_ENV__: string;
declare const __CF_PRODUCT_FLAVOR__: string;
declare const __CF_ARMS_RUM_ENDPOINT__: string;
declare const __CF_TELEMETRY_REPORT_ENDPOINT__: string;
declare const __CF_AUTO_UPDATE_ENABLED__: boolean;

export function normalizeCfEnv(value: string | undefined): CfEnv {
  return value?.trim().toLowerCase() === "production" ? "production" : "test";
}

export const CF_ENV = normalizeCfEnv(
  typeof __CF_ENV__ !== "undefined" ? __CF_ENV__ : undefined,
);

export function normalizeCfProductFlavor(
  value: string | undefined,
  cfEnv: CfEnv,
): CfProductFlavor {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "production" || normalized === "preview") {
    return normalized;
  }
  return cfEnv === "production" ? "production" : "preview";
}

export const CF_PRODUCT_FLAVOR = normalizeCfProductFlavor(
  typeof __CF_PRODUCT_FLAVOR__ !== "undefined" ? __CF_PRODUCT_FLAVOR__ : undefined,
  CF_ENV,
);
export const CF_APP_VERSION_ENV = "CF_APP_VERSION" as const;
export const CF_BUILD_COMMIT_ID_ENV = "CF_BUILD_COMMIT_ID" as const;

export const RUNTIME_CF_DEBUG =
  typeof process !== "undefined" ? process.env.CF_DEBUG : undefined;

export const CF_ARMS_RUM_ENDPOINT: string =
  typeof __CF_ARMS_RUM_ENDPOINT__ !== "undefined" ? __CF_ARMS_RUM_ENDPOINT__ : "";

export const CF_TELEMETRY_REPORT_ENDPOINT: string =
  typeof __CF_TELEMETRY_REPORT_ENDPOINT__ !== "undefined"
    ? __CF_TELEMETRY_REPORT_ENDPOINT__
    : "";

export const CF_AUTO_UPDATE_ENABLED: boolean =
  typeof __CF_AUTO_UPDATE_ENABLED__ !== "undefined" ? __CF_AUTO_UPDATE_ENABLED__ : false;

export function mapCfEnvToArmsRumEnv(runtimeEnv: CfRuntimeEnv): ArmsRumEnv {
  return runtimeEnv !== "development" && CF_ENV === "production" ? "prod" : "local";
}
