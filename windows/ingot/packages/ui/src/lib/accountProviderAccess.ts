import type { ProviderSettingsView } from "@origin-ai/cf-services";
import { type CfProviderAccountAccess, cfProviderAccountAccessSchema } from "@origin-ai/cf-shared";

export interface EntitledAccountProviderAccess {
  readonly providerId: string;
  readonly access: CfProviderAccountAccess;
  readonly label?: string;
}

export function resolveEntitledAccountProviderAccess(
  view: ProviderSettingsView | null | undefined,
  providerId: string,
): EntitledAccountProviderAccess | null {
  const provider = view?.providers.find((entry) => entry.providerId === providerId);
  if (provider?.effectiveConfig.access?.type !== "zhipu-account") {
    return null;
  }

  const parsed = cfProviderAccountAccessSchema.safeParse(provider.effectiveConfig.access);
  if (!parsed.success || parsed.data.entitled !== true) return null;
  const label = provider.providerName?.trim();
  return {
    providerId,
    access: parsed.data,
    ...(label ? { label } : {}),
  };
}

export function resolveEntitledAccountProviderAccessFingerprint(
  view: ProviderSettingsView | null | undefined,
  providerId: string,
): string {
  const access = resolveEntitledAccountProviderAccess(view, providerId);
  return access ? JSON.stringify([view?.revision, access.providerId, access.access]) : "";
}

export function resolveAccountProviderInspectionAccess(
  view: ProviderSettingsView | null | undefined,
  providerId: string,
): EntitledAccountProviderAccess | null {
  const provider = view?.providers.find((entry) => entry.providerId === providerId);
  if (!provider) return null;
  if (
    provider.accountState?.availability === "unavailable" &&
    !(
      provider.effectiveConfig.access?.type === "zhipu-account" &&
      provider.effectiveConfig.access.mode === "start-plan" &&
      provider.accountState.unavailableReason === "not-entitled"
    )
  )
    return null;
  const parsed = cfProviderAccountAccessSchema.safeParse(provider.effectiveConfig.access);
  if (!parsed.success || parsed.data.mode === "off-peak") return null;
  if (!provider.accountState && parsed.data.entitled !== true) return null;
  return { providerId, access: parsed.data };
}
