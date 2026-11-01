import type {
  RequestVerificationConfig,
  CodingPlanAgreementResponse,
  CodingPlanBatchPreviewRequest,
  CodingPlanBatchPreviewResponse,
  CodingPlanCreateSignRequest,
  CodingPlanPaymentCheckRequest,
  CodingPlanPaymentCheckResponse,
  CodingPlanPendingOrderCheckRequest,
  CodingPlanPendingOrderCheckResponse,
  CodingPlanPaypalSetupTokenRequest,
  CodingPlanPaypalSetupTokenResponse,
  CodingPlanPaypalSubscribeRequest,
  CodingPlanPaypalSubscribeResponse,
  CodingPlanPaypalSupportRequest,
  CodingPlanPaypalSupportResponse,
  CodingPlanProductInfo,
  CodingPlanProductInfoRequest,
  CodingPlanBillingDiscountConfig,
  CodingPlanStaticProductsConfig,
  CodingPlanStaticTeamProductsConfig,
  CodingPlanPreviewRequest,
  CodingPlanPreviewResponse,
  CodingPlanStripeBindRequest,
  CodingPlanStripeBindResponse,
  CodingPlanStripeCard,
  CodingPlanStripePayRequest,
  CodingPlanStripePayResponse,
  CodingPlanStripeUnbindRequest,
  CodingPlanUpdateSignRequest,
  EnterpriseCodingPlanCreateOrderRequest,
  EnterpriseCodingPlanCreateOrderResponse,
  EnterpriseCodingPlanCancelOrderRequest,
  EnterpriseCodingPlanCancelOrderResponse,
  EnterpriseCodingPlanBalanceResponse,
  EnterpriseCodingPlanContinuePayRequest,
  EnterpriseCodingPlanOrderCalculateRequest,
  EnterpriseCodingPlanOrderCalculateResponse,
  EnterpriseCodingPlanPendingOrder,
  EnterpriseCodingPlanOrderStatusRequest,
  EnterpriseCodingPlanOrderStatusResponse,
  EnterpriseCodingPlanPricingRequest,
  EnterpriseCodingPlanPricingResponse,
  StartPlanPreviewConfig,
  CfModelContextBudgetStrategy,
  ForceUpdateConfig,
  ManualClaimPlanPreviewSnapshot,
  ManualClaimPlanClaimRequest,
  ManualClaimPlanClaimResult,
  DynamicWorkflowClientConfig,
} from "@origin-ai/cf-shared";
import type { ModelSelectionView } from "@origin-ai/cf-provider";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface OffPeakClientConfig {
  readonly enabled: boolean;
  readonly modelSelectionView: ModelSelectionView;
  
  readonly codingPlanActive?: boolean;
}

export interface ICodingPlanSubscriptionService {
  batchPreview(request?: CodingPlanBatchPreviewRequest): Promise<CodingPlanBatchPreviewResponse>;
  getStaticProducts(): Promise<CodingPlanStaticProductsConfig>;
  getStaticTeamProducts(): Promise<CodingPlanStaticTeamProductsConfig>;
  getStartPlanPreview(): Promise<StartPlanPreviewConfig | null>;
  getManualClaimPlanPreviews(): Promise<ManualClaimPlanPreviewSnapshot>;
  claimManualPlan(request: ManualClaimPlanClaimRequest): Promise<ManualClaimPlanClaimResult>;
  
  getOffPeakClientConfig(options?: { forceRefresh?: boolean }): Promise<OffPeakClientConfig>;
  
  getDynamicWorkflowClientConfig(options?: {
    forceRefresh?: boolean;
  }): Promise<DynamicWorkflowClientConfig>;
  
  getModelContextBudgetStrategy(): Promise<CfModelContextBudgetStrategy>;
  getBillingDiscount(): Promise<CodingPlanBillingDiscountConfig | undefined>;
  getRequestVerificationConfig(): Promise<RequestVerificationConfig | null>;
  getForceUpdateConfig(): Promise<ForceUpdateConfig | null>;
  productInfo(request: CodingPlanProductInfoRequest): Promise<CodingPlanProductInfo>;
  preview(request: CodingPlanPreviewRequest): Promise<CodingPlanPreviewResponse>;
  createSign(request: CodingPlanCreateSignRequest): Promise<CodingPlanAgreementResponse>;
  updateSign(request: CodingPlanUpdateSignRequest): Promise<CodingPlanAgreementResponse>;
  checkPayment(request: CodingPlanPaymentCheckRequest): Promise<CodingPlanPaymentCheckResponse>;
  checkPendingOrders(
    request?: CodingPlanPendingOrderCheckRequest,
  ): Promise<CodingPlanPendingOrderCheckResponse>;
  queryStripeCards(request?: {
    providerId?: CodingPlanPreviewRequest["providerId"];
  }): Promise<CodingPlanStripeCard[]>;
  bindStripeCard(request: CodingPlanStripeBindRequest): Promise<CodingPlanStripeBindResponse>;
  unbindStripeCard(request: CodingPlanStripeUnbindRequest): Promise<string>;
  payStripe(request: CodingPlanStripePayRequest): Promise<CodingPlanStripePayResponse>;
  checkPaypalSupport(
    request?: CodingPlanPaypalSupportRequest,
  ): Promise<CodingPlanPaypalSupportResponse>;
  createPaypalSetupToken(
    request: CodingPlanPaypalSetupTokenRequest,
  ): Promise<CodingPlanPaypalSetupTokenResponse>;
  subscribePaypal(
    request: CodingPlanPaypalSubscribeRequest,
  ): Promise<CodingPlanPaypalSubscribeResponse>;
  getEnterprisePricing(
    request?: EnterpriseCodingPlanPricingRequest,
  ): Promise<EnterpriseCodingPlanPricingResponse>;
  getEnterpriseBalance(): Promise<EnterpriseCodingPlanBalanceResponse>;
  calculateEnterpriseOrder(
    request: EnterpriseCodingPlanOrderCalculateRequest,
  ): Promise<EnterpriseCodingPlanOrderCalculateResponse>;
  createEnterpriseOrder(
    request: EnterpriseCodingPlanCreateOrderRequest,
  ): Promise<EnterpriseCodingPlanCreateOrderResponse>;
  getEnterprisePendingOrders(): Promise<EnterpriseCodingPlanPendingOrder[]>;
  cancelEnterpriseOrder(
    request: EnterpriseCodingPlanCancelOrderRequest,
  ): Promise<EnterpriseCodingPlanCancelOrderResponse>;
  continueEnterpriseOrderPayment(
    request: EnterpriseCodingPlanContinuePayRequest,
  ): Promise<EnterpriseCodingPlanCreateOrderResponse>;
  checkEnterpriseOrderStatus(
    request: EnterpriseCodingPlanOrderStatusRequest,
  ): Promise<EnterpriseCodingPlanOrderStatusResponse>;
}

export const ICodingPlanSubscriptionService =
  createServiceDescriptor<ICodingPlanSubscriptionService>(ServiceChannels.CodingPlanSubscription);
