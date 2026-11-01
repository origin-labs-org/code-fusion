import { parseRuntimeInputPresentation } from "@origin-ai/cf-contracts";
import type { RuntimeMessageMetadata } from "./message-history.js";

export function runtimeInputMetadata(value: unknown): RuntimeMessageMetadata | undefined {
  const inputPresentation = parseRuntimeInputPresentation(value);
  if (!inputPresentation) return undefined;
  return {
    source: inputPresentation === "user_steer" ? "real_user" : "legacy_synthetic",
    inputPresentation,
  };
}
