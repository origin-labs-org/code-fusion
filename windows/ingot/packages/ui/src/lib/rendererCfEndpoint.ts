import {
  buildRuntimeCfEndpointUrls,
  CF_ENV,
  type RuntimeCfEndpointEnv,
} from "@origin-ai/cf-shared";

interface RendererImportMetaEnv {
  VITE_CF_BASE_URL?: string;
  VITE_CF_ENDPOINT_ORIGIN?: string;
}

function readRendererImportMetaEnv(): RendererImportMetaEnv {
  return ((import.meta as ImportMeta & { env?: RendererImportMetaEnv }).env ??
    {}) as RendererImportMetaEnv;
}

export function createRendererCfEndpointEnv(
  env: RendererImportMetaEnv = readRendererImportMetaEnv(),
): RuntimeCfEndpointEnv {
  return {
    CF_ENV,
    CF_BASE_URL: env.VITE_CF_BASE_URL,
    CF_ENDPOINT_ORIGIN: env.VITE_CF_ENDPOINT_ORIGIN,
  };
}

export const RENDERER_CF_ENDPOINT_URLS = buildRuntimeCfEndpointUrls(
  createRendererCfEndpointEnv(),
);
