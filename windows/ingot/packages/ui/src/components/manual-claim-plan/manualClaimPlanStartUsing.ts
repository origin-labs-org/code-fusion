import type { ProviderSettingsView } from "@origin-ai/cf-services";

export interface ManualClaimPlanStartUsingTarget {
  readonly providerExecutable?: boolean;
  readonly modelCount?: number;
  readonly modelExecutable?: boolean;
  readonly modelSelectable?: boolean;
}

export type ManualClaimPlanStartUsingTargetResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "missing-provider" | "provider-not-executable" | "no-executable-model";
    };

export function resolveManualClaimPlanStartUsingTarget(
  view: ProviderSettingsView | null | undefined,
  providerId: string,
): ManualClaimPlanStartUsingTargetResult {
  const provider = view?.providers.find((entry) => entry.providerId === providerId);
  if (!provider) return { ok: false, reason: "missing-provider" };
  if (!provider.executable) return { ok: false, reason: "provider-not-executable" };
  if (!provider.models.some((model) => model.executable && model.selectable)) {
    return { ok: false, reason: "no-executable-model" };
  }
  return { ok: true };
}
