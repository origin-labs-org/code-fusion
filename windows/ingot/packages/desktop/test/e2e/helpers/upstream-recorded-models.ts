export const RECORDED_UPSTREAM_MODEL = "deepseek-v4-flash";
export const RECORDED_UPSTREAM_SECONDARY_MODEL = "deepseek-v4-pro";

export function resolveUpstreamModels(env: NodeJS.ProcessEnv = process.env) {
  const capture = env.E2E_PROVIDER_HTTP_MODE?.trim() === "capture";
  return {
    model: (capture && env.E2E_PROVIDER_MODEL?.trim()) || RECORDED_UPSTREAM_MODEL,
    secondaryModel:
      (capture && env.E2E_PROVIDER_SECONDARY_MODEL?.trim()) || RECORDED_UPSTREAM_SECONDARY_MODEL,
  };
}
