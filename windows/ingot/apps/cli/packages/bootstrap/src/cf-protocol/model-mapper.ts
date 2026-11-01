import type { ModelSelection } from "@origin-ai/cf-shared";
import { parseProviderQualifiedModelSelection } from "../app/provider-registry-selection.js";

export function formatProtocolModelSelection(ref: ModelSelection): string {
  return `${ref.providerId}/${ref.modelId}`;
}

export function modelSelectionFromString(input: string): ModelSelection {
  const selection = parseProviderQualifiedModelSelection(input);
  if (!selection) throw new Error(`Invalid provider-qualified model selection: ${input}`);
  return selection;
}

export function optionalModelSelectionFromString(input: string): ModelSelection | undefined {
  return input.trim() ? modelSelectionFromString(input) : undefined;
}
