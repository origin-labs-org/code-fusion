import type { ProviderConfigObject } from "@origin-ai/cf-provider";

export function shouldShowModelVisionBadge(
  modelId: string,
  supportsImage: boolean | null | undefined,
  access?: ProviderConfigObject["access"],
): boolean {
  if (supportsImage !== true) return false;
  const hideGlm53Vision =
    access?.type === "zhipu-coding-plan-api-key" ||
    (access?.type === "zhipu-account" &&
      (access.mode === "individual-coding-plan" ||
        access.mode === "team-coding-plan" ||
        access.mode === "start-plan"));
  return !(hideGlm53Vision && modelId.toLowerCase() === "glm-5.3");
}
