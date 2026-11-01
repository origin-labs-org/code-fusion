import type { GenUiTweakMessage, GenUiTweakResult } from "@origin-ai/cf-shared/gen-ui";

export function installGenUiTweakRuntime(
  callTool: (
    name: "__cf_visualization_annotations__",
    message: GenUiTweakMessage,
  ) => Promise<GenUiTweakResult>,
): void;
