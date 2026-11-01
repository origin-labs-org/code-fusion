import type { IServiceAccessor } from "@origin-ai/cf-services";
import type { EnterpriseCodingPlanPricingProduct, ProviderFamilyDomain } from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";

type EnterprisePricingProductsResult =
  | { status: "success"; productList: EnterpriseCodingPlanPricingProduct[] }
  | { status: "error" };

export async function getEnterprisePricingProducts(
  services: IServiceAccessor,
  domain: ProviderFamilyDomain,
): Promise<EnterprisePricingProductsResult> {
  try {
    const pricing = await services.codingPlanSubscriptionService.getEnterprisePricing({
      authenticated: true,
      family: domain,
    });
    return { status: "success", productList: pricing.productList };
  } catch (error) {
    logger.warn("[Root] Failed to refresh team plan after sign-in", { domain, error });
    return { status: "error" };
  }
}

export async function getEnterprisePricingProductsOrEmpty(
  services: IServiceAccessor,
  domain: ProviderFamilyDomain,
): Promise<EnterpriseCodingPlanPricingProduct[]> {
  const pricing = await getEnterprisePricingProducts(services, domain);
  return pricing.status === "success" ? pricing.productList : [];
}
