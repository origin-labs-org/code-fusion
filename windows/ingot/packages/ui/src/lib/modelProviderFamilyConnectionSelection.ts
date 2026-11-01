import type {
  EnterpriseCodingPlanPricingProduct,
  ProviderFamilyConnectionSelection,
  ProviderFamilyDomain,
  UsageEntitlementSnapshot,
} from "@origin-ai/cf-shared";
import { getModelProviderFamilySpec } from "@origin-ai/cf-shared";
import { hasActiveUsageEntitlementSnapshot } from "@/lib/codingPlanProvider.js";

export type ModelProviderFamilyConnectionSelection = ProviderFamilyConnectionSelection;

export function resolveModelProviderFamilyConnectionProviderId(params: {
  providerFamilyDomain: ProviderFamilyDomain;
  selection: ProviderFamilyConnectionSelection;
}): string {
  const familySpec = getModelProviderFamilySpec(params.providerFamilyDomain);
  switch (params.selection.kind) {
    case "start-plan":
      return familySpec.startPlanProviderId;
    case "individual-coding-plan":
      return familySpec.individualCodingPlanProviderId;
    case "team-coding-plan":
      return familySpec.teamCodingPlanProviderId;
  }
}

export function resolveFirstSubscribedTeamPlanConnectionWithContext(params: {
  teamProducts: readonly EnterpriseCodingPlanPricingProduct[];
}): Extract<ProviderFamilyConnectionSelection, { kind: "team-coding-plan" }> | null {
  for (const product of params.teamProducts) {
    if (product.subscribed !== true) continue;
    const projectContexts =
      product.teamProjects && product.teamProjects.length > 0
        ? product.teamProjects
        : [
            {
              organizationId: product.organizationId ?? "",
              projectId: product.projectId ?? "",
              apiKeyStatus: product.apiKeyStatus,
            },
          ];
    for (const projectContext of projectContexts) {
      if (projectContext.apiKeyStatus === "unavailable") continue;
      const organizationId = projectContext.organizationId?.trim() ?? "";
      const projectId = projectContext.projectId?.trim() ?? "";
      if (!organizationId || !projectId) continue;
      return {
        kind: "team-coding-plan",
        productId: product.productId,
        organizationId,
        projectId,
      };
    }
  }
  return null;
}

export function resolveAutomaticModelProviderFamilyConnectionSelection(params: {
  providerFamilyDomain: ProviderFamilyDomain;
  codingPlanEntitlement: UsageEntitlementSnapshot | null;
  startPlanEntitlement: UsageEntitlementSnapshot | null;
  teamProducts?: readonly EnterpriseCodingPlanPricingProduct[];
  
  allowPurchaseEntry?: boolean;
  
  codingPlanAvailable?: boolean;
  startPlanAvailable?: boolean;
}): ModelProviderFamilyConnectionSelection | null {
  const familySpec = getModelProviderFamilySpec(params.providerFamilyDomain);

  if (
    params.codingPlanAvailable ??
    hasActiveUsageEntitlementSnapshot(
      params.codingPlanEntitlement,
      familySpec.individualCodingPlanProviderId,
    )
  ) {
    return {
      kind: "individual-coding-plan",
    };
  }

  const teamSelection = resolveFirstSubscribedTeamPlanConnectionWithContext({
    teamProducts: params.teamProducts ?? [],
  });
  if (teamSelection) return teamSelection;

  if (params.allowPurchaseEntry === false) return null;
  return {
    kind: "individual-coding-plan",
  };
}
