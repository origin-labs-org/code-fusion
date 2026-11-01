import { resolveCfRuntimeEnv } from "@origin-ai/cf-shared";
export function resolveEffectiveNodeEnv(env = process.env) {
    const runtimeEnv = resolveCfRuntimeEnv(env);
    return runtimeEnv === "development" ? "development" : "production";
}
export function isEffectiveDevelopmentNodeEnv(env = process.env) {
    return resolveEffectiveNodeEnv(env) === "development";
}
//# sourceMappingURL=nodeEnv.js.map