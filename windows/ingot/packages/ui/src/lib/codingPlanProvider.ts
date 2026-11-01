import { type UsageEntitlementSnapshot } from "@origin-ai/cf-shared";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";

export function pickCodingPlanEntitlementProvider(
  codingPlanProvider: ProviderSettingsFormProvider | null | undefined,
): ProviderSettingsFormProvider | null {
  return codingPlanProvider ?? null;
}

export function hasActiveUsageEntitlementSnapshot(
  snapshot: UsageEntitlementSnapshot | null,
  providerId?: string,
): boolean {
  return resolveUsageEntitlementOutcome(snapshot, providerId) === "active";
}

export type UsageEntitlementOutcome = "active" | "inactive" | "unknown";

export function resolveUsageEntitlementOutcome(
  snapshot: UsageEntitlementSnapshot | null,
  providerId?: string,
): UsageEntitlementOutcome {
  if (!snapshot) return "unknown";
  if (providerId && snapshot.provider?.id && snapshot.provider.id !== providerId) {
    return "unknown";
  }
  if (snapshot.unavailableReason === "no_plan") return "inactive";
  return snapshot.subscription?.details.length ? "active" : "unknown";
}
