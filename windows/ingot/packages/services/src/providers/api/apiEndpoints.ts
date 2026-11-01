import { buildRuntimeCfApiUrl, resolveZaiBusinessBaseUrl } from "@origin-ai/cf-shared";

export const CF_CLIENT_SCENES_URL = buildRuntimeCfApiUrl(
  process.env,
  "/api/v1/client/scenes",
);

export const ZAI_API_HOST = resolveZaiBusinessBaseUrl(process.env);
