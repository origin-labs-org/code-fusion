import { resolveCfRuntimeEnv } from "@origin-ai/cf-shared";

export type EffectiveNodeEnv = "development" | "production";

export function resolveEffectiveNodeEnv(
  env: Record<string, string | undefined> = process.env,
): EffectiveNodeEnv {
  const runtimeEnv = resolveCfRuntimeEnv(env);
  return runtimeEnv === "development" ? "development" : "production";
}

export function isEffectiveDevelopmentNodeEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return resolveEffectiveNodeEnv(env) === "development";
}
