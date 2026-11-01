import {
  readRequestVerificationConfig,
  requestVerificationClaimHeaders,
  isRequestVerificationMessage,
  type RequestVerificationClientConfig,
} from "@origin-ai/cf-shared";

import type {
  ApiClient,
  ApiRequestInit,
  RequestVerificationConfig,
  ForceUpdateConfig,
  CodingPlanAgreementResponse,
  CodingPlanBatchPreviewRequest,
  CodingPlanBatchPreviewResponse,
  CodingPlanCreateSignRequest,
  CodingPlanPaymentCheckRequest,
  CodingPlanPaymentCheckResponse,
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
  CodingPlanStaticTeamProduct,
  CodingPlanStaticProductsConfig,
  CodingPlanStaticTeamProductsConfig,
  CodingPlanSubscriptionProviderId,
  CodingPlanPreviewRequest,
  CodingPlanPreviewResponse,
  CodingPlanStripeBindRequest,
  CodingPlanStripeBindResponse,
  CodingPlanStripeCard,
  CodingPlanStripePayRequest,
  CodingPlanStripePayResponse,
  CodingPlanStripeUnbindRequest,
  CodingPlanUpdateSignRequest,
  EnterpriseCodingPlanCancelOrderRequest,
  EnterpriseCodingPlanCancelOrderResponse,
  EnterpriseCodingPlanCreateOrderRequest,
  EnterpriseCodingPlanCreateOrderResponse,
  EnterpriseCodingPlanBalanceResponse,
  EnterpriseCodingPlanContinuePayRequest,
  EnterpriseCodingPlanOrderCalculateRequest,
  EnterpriseCodingPlanOrderCalculateResponse,
  EnterpriseCodingPlanPendingOrder,
  EnterpriseCodingPlanOrderStatusRequest,
  EnterpriseCodingPlanOrderStatusResponse,
  EnterpriseCodingPlanPricingRequest,
  EnterpriseCodingPlanPricingResponse,
  EnterpriseCodingPlanPricingProduct,
  EnterpriseCodingPlanProjectApiKeyUnavailableReason,
  EnterpriseCodingPlanProjectContext,
  StartPlanPreviewConfig,
  ManualClaimPlanClaimRequest,
  ManualClaimPlanClaimResult,
  ManualClaimPlanPreviewSnapshot,
  CfModelContextBudgetStrategy,
  DynamicWorkflowClientConfig,
} from "@origin-ai/cf-shared";
import type { ModelSelectionView } from "@origin-ai/cf-provider";
import type { OffPeakClientConfig } from "./codingPlanSubscription.js";
import {
  BIGMODEL_PROVIDER_ID,
  BUILTIN_MODEL_PROVIDER_IDS,
  REQUEST_VERIFICATION_REQUIRED,
  CODING_PLAN_SYSTEM_BUSY,
  buildRuntimeCfApiUrl,
  isZaiCodingPlanProviderId,
  resolveBigModelApiOrigin,
  resolveZaiBusinessBaseUrl,
  ZAI_PROVIDER_ID,
  CF_VERSION,
  DEFAULT_CF_MODEL_CONTEXT_BUDGET_STRATEGY,
  createDynamicWorkflowClientConfig,
  normalizeDynamicWorkflowMode,
  resolveDynamicWorkflowClientConfig,
  DEFAULT_DYNAMIC_WORKFLOW_MODE,
  CF_DYNAMIC_WORKFLOW_MODE_ENV,
} from "@origin-ai/cf-shared";
import type { ICredentialService } from "../credential/credential.js";
import { readApiJson } from "../providers/api/apiJson.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import {
  ensureBigModelTeamPlanProjectApiKeyWithStatus,
  type BigModelTeamPlanApiKeyEnsureResult,
  type BigModelTeamPlanBizContext,
} from "#src/bigmodel/teamPlanApiKey.js";

const BIGMODEL_CODING_PLAN_API_PREFIX = "/api/biz";
const ZAI_CODING_PLAN_PAY_API_PREFIX = "/api/pay";
const CF_CLIENT_CONFIG_API_PREFIX = "/api/v1/client/configs";
const REQUEST_TIMEOUT_MS = 15_000;
const CLIENT_CONFIG_CACHE_TTL_MS = 60 * 60 * 1000;
const CODING_PLAN_ZAI_OVERSEAS_PAYMENT_REQUIRED = "coding_plan_zai_overseas_payment_required";
const CF_JWT_TOKEN_KEY = "cfjwttoken";
const log = createServiceLogger("codingPlanSubscription");

function readServerTimeMilliseconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value * 1_000
    : undefined;
}

interface RemoteEnvelope<T> {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: T | null;
}

interface ManualClaimPlanPreviewPayload {
  server_time?: number;
  plans?: Array<{
    plan_id?: string;
    name?: string;
    description?: string;
    priority?: number;
    entitlements?: Array<{
      entitlement_id?: string;
      show_name?: string;
      meter?: string;
      unit_type?: string;
      capabilities?: string[];
      grant_units?: number;
      period?: string;
      priority?: number;
      effective_at?: number;
    }>;
  }>;
}

interface ManualClaimPlanClaimPayload {
  server_time?: number;
  message?: unknown;
  plan?: {
    user_plan_id?: string;
    plan_id?: string;
    status?: string;
    starts_at?: number;
    ends_at?: number;
    entitlements?: Array<{
      entitlement_id?: string;
      show_name?: string;
      effective_at?: number;
    }>;
  };
}

interface CfClientConfigEnvelope {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: {
    configs?:
      | (RequestVerificationClientConfig & {
          forceUpdate?: ForceUpdateConfig | null;
          codingPlanBillingDiscount?: CodingPlanBillingDiscountConfig;
          codingPlanStaticProducts?: CodingPlanStaticProductsConfig;
          codingPlanStaticTeamProducts?: CodingPlanStaticTeamProductsConfig;
          startPlanPreview?: StartPlanPreviewConfig | null;
          offPeak?: {
            enable_offpeak_task?: boolean;
          } | null;
          modelContextBudget?: {
            strategy?: unknown;
          } | null;
          dynamicWorkflow?: {
            mode?: unknown;
          } | null;
        })
      | null;
  } | null;
}

interface BigModelCodingPlanSubscriptionProviderOptions {
  apiClient: ApiClient;
  credentialService: Pick<ICredentialService, "load">;
  resolveOffPeakModelSelectionView?: () => Promise<ModelSelectionView>;
}

interface TeamPlanProjectApiKeyPrewarmStatus {
  status: "available" | "unavailable";
  reason?: EnterpriseCodingPlanProjectApiKeyUnavailableReason;
  message?: string | null;
}

interface CodingPlanEndpointConfig {
  providerId: CodingPlanSubscriptionProviderId;
  host: string;
  headers: Record<string, string>;
}

interface BigModelCustomerInfoResponse {
  organizations?: Array<{
    organizationId?: string | null;
    organizationName?: string | null;
    projects?: Array<{
      projectId?: string | null;
      projectName?: string | null;
      projectType?: number | string | null;
    }> | null;
  }> | null;
}

export class BigModelCodingPlanSubscriptionProvider {
  protected readonly apiClient: ApiClient;
  protected readonly credentialService: Pick<ICredentialService, "load">;
  private readonly resolveOffPeakModelSelectionView?: () => Promise<ModelSelectionView>;
  private clientConfigSnapshot: CfClientConfigEnvelope | null = null;
  private clientConfigSnapshotExpiresAt = 0;
  private clientConfigRequest: Promise<CfClientConfigEnvelope> | null = null;

  constructor(options: BigModelCodingPlanSubscriptionProviderOptions) {
    this.apiClient = options.apiClient;
    this.credentialService = options.credentialService;
    this.resolveOffPeakModelSelectionView = options.resolveOffPeakModelSelectionView;
  }

  
  protected codingPlanProviderId(): CodingPlanSubscriptionProviderId {
    return BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
  }

  
  protected resolveFamilyEnterpriseHost(): string {
    return resolveBigModelApiOrigin(process.env);
  }

  
  protected async loadFamilyEnterpriseToken(): Promise<string> {
    return this.loadBigModelAccessToken();
  }

  
  protected createFamilyEnterpriseAuthHeaders(token: string): Record<string, string> {
    return createBigModelLoginAuthHeaders(token);
  }

  async batchPreview(
    request: CodingPlanBatchPreviewRequest = {},
  ): Promise<CodingPlanBatchPreviewResponse> {
    return this.post<CodingPlanBatchPreviewResponse>(request.providerId, "/pay/batch-preview", {
      invitationCode: request.invitationCode,
    });
  }

  async getStaticProducts(): Promise<CodingPlanStaticProductsConfig> {
    const payload = await this.getClientConfigs();
    return unwrapClientConfigProducts(payload);
  }

  async getStaticTeamProducts(): Promise<CodingPlanStaticTeamProductsConfig> {
    const payload = await this.getClientConfigs();
    return unwrapClientConfigTeamProducts(payload);
  }

  async getStartPlanPreview(): Promise<StartPlanPreviewConfig | null> {
    const payload = await this.getClientConfigs();
    return unwrapClientConfigStartPlanPreview(payload);
  }

  async getManualClaimPlanPreviews(): Promise<ManualClaimPlanPreviewSnapshot> {
    const token = (await this.credentialService.load(CF_JWT_TOKEN_KEY))?.trim();
    const url = new URL(buildRuntimeCfApiUrl(process.env, "/api/v1/cf-plan/billing/preview"));
    url.searchParams.set("app_version", CF_VERSION);
    url.searchParams.set("platform", resolveClientPlatformKey());
    const payload = await readCodingPlanApiJson<RemoteEnvelope<ManualClaimPlanPreviewPayload>>(
      this.apiClient,
      url,
      {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
    );
    if (payload.code !== undefined && payload.code !== 0) {
      throw new Error(payload.msg?.trim() || "manual_claim_preview_failed");
    }
    if (!payload.data) {
      throw new Error(payload.msg?.trim() || "manual_claim_preview_missing_data");
    }
    const data = payload.data;
    const serverTime = readServerTimeMilliseconds(data.server_time);
    const plans = (data.plans ?? []).flatMap((plan) => {
      const planId = plan.plan_id?.trim() ?? "";
      if (!planId) return [];
      return [
        {
          planId,
          name: plan.name?.trim() || planId,
          description: plan.description?.trim() ?? "",
          priority: Number.isFinite(plan.priority) ? (plan.priority ?? 0) : 0,
          entitlements: (plan.entitlements ?? []).flatMap((entitlement) => {
            const entitlementId = entitlement.entitlement_id?.trim() ?? "";
            if (!entitlementId) return [];
            return [
              {
                entitlementId,
                showName: entitlement.show_name?.trim() ?? "",
                meter: entitlement.meter?.trim() ?? "",
                unitType: entitlement.unit_type?.trim() ?? "",
                capabilities: entitlement.capabilities ?? [],
                grantUnits: Number.isFinite(entitlement.grant_units)
                  ? (entitlement.grant_units ?? 0)
                  : 0,
                period: entitlement.period?.trim() ?? "",
                priority: Number.isFinite(entitlement.priority) ? (entitlement.priority ?? 0) : 0,
                ...(Number.isFinite(entitlement.effective_at)
                  ? { effectiveAt: entitlement.effective_at }
                  : {}),
              },
            ];
          }),
        },
      ];
    });
    return { ...(serverTime === undefined ? {} : { serverTime }), plans };
  }

  async claimManualPlan(request: ManualClaimPlanClaimRequest): Promise<ManualClaimPlanClaimResult> {
    const token = (await this.credentialService.load(CF_JWT_TOKEN_KEY))?.trim();
    if (!token) {
      return { success: false, code: 401, message: "" };
    }
    const payload = await readCodingPlanApiJson<
      Omit<RemoteEnvelope<ManualClaimPlanClaimPayload>, "code"> & { code?: number | string }
    >(
      this.apiClient,
      new URL(buildRuntimeCfApiUrl(process.env, "/api/v1/cf-plan/billing/claim")),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...requestVerificationClaimHeaders(request),
          "X-CodeFusion-App-Version": CF_VERSION,
          "X-Platform": resolveClientPlatformKey(),
        },
        body: JSON.stringify({ plan_id: request.planId }),
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
    );
    const rawCode = payload.code;
    const code =
      typeof rawCode === "number"
        ? rawCode
        : typeof rawCode === "string" && /^\d+$/.test(rawCode)
          ? Number(rawCode)
          : -1;
    const serverTime = readServerTimeMilliseconds(payload.data?.server_time);
    if (code !== 0 || !payload.data?.plan) {
      const failureEndsAt = payload.data?.plan?.ends_at;
      return {
        success: false,
        code,
        message: typeof payload.data?.message === "string" ? payload.data.message : "",
        ...(serverTime === undefined ? {} : { serverTime }),
        ...(Number.isFinite(failureEndsAt) ? { failureEndsAt } : {}),
      };
    }
    const plan = payload.data.plan;
    return {
      success: true,
      code,
      message: payload.msg?.trim() ?? "",
      ...(serverTime === undefined ? {} : { serverTime }),
      plan: {
        userPlanId: plan.user_plan_id?.trim() ?? "",
        planId: plan.plan_id?.trim() || request.planId,
        status: plan.status?.trim() ?? "",
        ...(Number.isFinite(plan.starts_at) ? { startsAt: plan.starts_at } : {}),
        ...(Number.isFinite(plan.ends_at) ? { endsAt: plan.ends_at } : {}),
        entitlements: (plan.entitlements ?? []).flatMap((entitlement) => {
          const entitlementId = entitlement.entitlement_id?.trim() ?? "";
          if (!entitlementId) return [];
          return [
            {
              entitlementId,
              showName: entitlement.show_name?.trim() ?? "",
              ...(Number.isFinite(entitlement.effective_at)
                ? { effectiveAt: entitlement.effective_at }
                : {}),
            },
          ];
        }),
      },
    };
  }

  
  async getOffPeakClientConfig(options?: { forceRefresh?: boolean }): Promise<OffPeakClientConfig> {
    if (process.env["CF_OFFPEAK_MOCK"] === "1") {
      const modelSelectionView = await this.resolveOffPeakModelSelectionView?.();
      return resolveOffPeakClientConfig({}, process.env, modelSelectionView);
    }
    if (options?.forceRefresh) {
      this.clientConfigSnapshot = null;
      this.clientConfigSnapshotExpiresAt = 0;
    }
    const payload = await this.getClientConfigs();
    const modelSelectionView = await this.resolveOffPeakModelSelectionView?.();
    return resolveOffPeakClientConfig(payload, process.env, modelSelectionView);
  }

  
  async getDynamicWorkflowClientConfig(options?: {
    forceRefresh?: boolean;
  }): Promise<DynamicWorkflowClientConfig> {
    if (normalizeDynamicWorkflowMode(process.env[CF_DYNAMIC_WORKFLOW_MODE_ENV])) {
      return resolveDynamicWorkflowClientConfig({ remote: undefined, env: process.env });
    }
    if (options?.forceRefresh) {
      this.clientConfigSnapshot = null;
      this.clientConfigSnapshotExpiresAt = 0;
    }
    try {
      const payload = await this.getClientConfigs();
      return resolveDynamicWorkflowClientConfig({
        remote: payload.data?.configs?.dynamicWorkflow,
        env: process.env,
      });
    } catch (error) {
      log.warn(undefined, "动态工作流灰度配置读取失败，按关闭处理", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return createDynamicWorkflowClientConfig(DEFAULT_DYNAMIC_WORKFLOW_MODE, "default");
    }
  }

  async getModelContextBudgetStrategy(): Promise<CfModelContextBudgetStrategy> {
    return DEFAULT_CF_MODEL_CONTEXT_BUDGET_STRATEGY;
  }

  async getBillingDiscount(): Promise<CodingPlanBillingDiscountConfig | undefined> {
    const payload = await this.getClientConfigs();
    return unwrapClientConfigBillingDiscount(payload);
  }

  async getRequestVerificationConfig(): Promise<RequestVerificationConfig | null> {
    return readRequestVerificationConfig((await this.getClientConfigs()).data?.configs);
  }

  async getForceUpdateConfig(): Promise<ForceUpdateConfig | null> {
    const payload = await this.getClientConfigs();
    return unwrapClientConfigForceUpdate(payload);
  }

  async preview(request: CodingPlanPreviewRequest): Promise<CodingPlanPreviewResponse> {
    return this.post<CodingPlanPreviewResponse>(
      request.providerId,
      resolvePreviewPath(request.providerId),
      {
        productId: request.productId,
        invitationCode: request.invitationCode,
        imRef: request.imRef ?? null,
        ticket: request.ticket ?? null,
        randstr: request.randstr ?? null,
        salesChannel: request.salesChannel ?? "cf",
      },
    );
  }

  async productInfo(request: CodingPlanProductInfoRequest): Promise<CodingPlanProductInfo> {
    const url = new URL(
      `${resolveCodingPlanHost(request.providerId)}${BIGMODEL_CODING_PLAN_API_PREFIX}/product/info`,
    );
    url.searchParams.set("productId", request.productId);
    return this.get<CodingPlanProductInfo>(request.providerId, url);
  }

  async createSign(request: CodingPlanCreateSignRequest): Promise<CodingPlanAgreementResponse> {
    if (request.providerId && isZaiCodingPlanProviderId(request.providerId)) {
      throw new Error(CODING_PLAN_ZAI_OVERSEAS_PAYMENT_REQUIRED);
    }

    return this.post<CodingPlanAgreementResponse>(request.providerId, "/pay/create-sign", {
      bizId: request.bizId,
      payType: request.payType ?? "ALI",
      invitationCode: request.invitationCode,
      renew: request.renew ?? null,
      isDelay: request.isDelay ?? 0,
      effectiveTime: request.effectiveTime ?? null,
    });
  }

  async updateSign(request: CodingPlanUpdateSignRequest): Promise<CodingPlanAgreementResponse> {
    if (request.providerId && isZaiCodingPlanProviderId(request.providerId)) {
      throw new Error(CODING_PLAN_ZAI_OVERSEAS_PAYMENT_REQUIRED);
    }

    return this.post<CodingPlanAgreementResponse>(request.providerId, "/pay/product/update/sign", {
      bizId: request.bizId,
      payType: request.payType ?? "ALI",
    });
  }

  async checkPayment(
    request: CodingPlanPaymentCheckRequest,
  ): Promise<CodingPlanPaymentCheckResponse> {
    const url = new URL(
      `${resolveCodingPlanHost(request.providerId)}${BIGMODEL_CODING_PLAN_API_PREFIX}/pay/check`,
    );
    url.searchParams.set("bizId", request.bizId);
    const status = await this.get<string>(request.providerId, url);
    return { status };
  }

  async checkPendingOrders(
    request: {
      providerId?: CodingPlanSubscriptionProviderId;
    } = {},
  ): Promise<CodingPlanPendingOrderCheckResponse> {
    return this.get<CodingPlanPendingOrderCheckResponse>(
      request.providerId,
      new URL(
        `${resolveCodingPlanHost(request.providerId)}${BIGMODEL_CODING_PLAN_API_PREFIX}/pay/check-pending-orders`,
      ),
    );
  }

  async queryStripeCards(
    request: {
      providerId?: CodingPlanSubscriptionProviderId;
    } = {},
  ): Promise<CodingPlanStripeCard[]> {
    return this.getZaiPay<CodingPlanStripeCard[]>(request.providerId, "/stripe/query");
  }

  async bindStripeCard(
    request: CodingPlanStripeBindRequest,
  ): Promise<CodingPlanStripeBindResponse> {
    return this.postZaiPay<CodingPlanStripeBindResponse>(request.providerId, "/stripe/bind", {
      paymentMethodId: request.paymentMethodId,
      returnUrl: request.returnUrl,
      trackingContext: request.trackingContext,
    });
  }

  async unbindStripeCard(request: CodingPlanStripeUnbindRequest): Promise<string> {
    return this.postZaiPay<string>(request.providerId, "/stripe/unbind", {
      paymentMethodId: request.paymentMethodId,
    });
  }

  async payStripe(request: CodingPlanStripePayRequest): Promise<CodingPlanStripePayResponse> {
    return this.postZaiPay<CodingPlanStripePayResponse>(request.providerId, "/stripe/pay", {
      productId: request.productId,
      paymentMethodId: request.paymentMethodId,
      isSubscribe: request.isSubscribe ?? true,
      returnUrl: request.returnUrl,
      channelCode: request.channelCode,
      estimatePayAmount: request.estimatePayAmount,
      invitationCode: request.invitationCode,
      bizId: request.bizId,
      renew: request.renew ?? false,
    });
  }

  async checkPaypalSupport(
    request: CodingPlanPaypalSupportRequest = {},
  ): Promise<CodingPlanPaypalSupportResponse> {
    return this.getZaiPay<CodingPlanPaypalSupportResponse>(request.providerId, "/paypal/isSupport");
  }

  async createPaypalSetupToken(
    request: CodingPlanPaypalSetupTokenRequest,
  ): Promise<CodingPlanPaypalSetupTokenResponse> {
    return this.postZaiPay<CodingPlanPaypalSetupTokenResponse>(
      request.providerId,
      "/paypal/setupToken",
      {
        returnUrl: request.returnUrl,
        cancelUrl: request.cancelUrl,
      },
    );
  }

  async subscribePaypal(
    request: CodingPlanPaypalSubscribeRequest,
  ): Promise<CodingPlanPaypalSubscribeResponse> {
    return this.postZaiPay<CodingPlanPaypalSubscribeResponse>(
      request.providerId,
      "/paypal/subscribe",
      {
        productId: request.productId,
        productDesc: request.productDesc,
        setupTokenId: request.setupTokenId,
        amount: request.amount,
        isSubscribe: request.isSubscribe ?? true,
        estimatePayAmount: request.estimatePayAmount,
        invitationCode: request.invitationCode,
        bizId: request.bizId,
        channelCode: request.channelCode,
      },
    );
  }

  async getEnterprisePricing(
    request: EnterpriseCodingPlanPricingRequest = {},
  ): Promise<EnterpriseCodingPlanPricingResponse> {
    const providerId = this.codingPlanProviderId();
    const host = this.resolveFamilyEnterpriseHost();
    if (request.authenticated === false) {
      const payload = await readCodingPlanApiJson<
        RemoteEnvelope<EnterpriseCodingPlanPricingResponse>
      >(
        this.apiClient,
        `${host}${BIGMODEL_CODING_PLAN_API_PREFIX}/campaign/partner/enterprise/pricing`,
        {
          method: "GET",
          timeoutMs: REQUEST_TIMEOUT_MS,
        },
      );
      return unwrapEnvelope(payload, providerId);
    }

    const response = await this.get<EnterpriseCodingPlanPricingResponse>(
      providerId,
      new URL(`${host}${BIGMODEL_CODING_PLAN_API_PREFIX}/subscription/enterprise/v2/pricing`),
    );
    return this.enrichEnterprisePricingTeamProjects(response);
  }

  async getEnterpriseBalance(): Promise<EnterpriseCodingPlanBalanceResponse> {
    return this.get<EnterpriseCodingPlanBalanceResponse>(
      BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      new URL(
        `${resolveBigModelEnterpriseHost()}${BIGMODEL_CODING_PLAN_API_PREFIX}/subscription/enterprise/v2/balance`,
      ),
    );
  }

  async calculateEnterpriseOrder(
    request: EnterpriseCodingPlanOrderCalculateRequest,
  ): Promise<EnterpriseCodingPlanOrderCalculateResponse> {
    return this.post<EnterpriseCodingPlanOrderCalculateResponse>(
      BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      "/subscription/enterprise/v2/order/calculate",
      { ...request },
    );
  }

  async createEnterpriseOrder(
    request: EnterpriseCodingPlanCreateOrderRequest,
  ): Promise<EnterpriseCodingPlanCreateOrderResponse> {
    return this.post<EnterpriseCodingPlanCreateOrderResponse>(
      BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      "/subscription/enterprise/v2/order",
      { ...request },
    );
  }

  async getEnterprisePendingOrders(): Promise<EnterpriseCodingPlanPendingOrder[]> {
    const url = new URL(
      `${resolveBigModelEnterpriseHost()}${BIGMODEL_CODING_PLAN_API_PREFIX}/subscription/enterprise/v2/orders/pending`,
    );
    return this.get<EnterpriseCodingPlanPendingOrder[]>(
      BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      url,
    );
  }

  async cancelEnterpriseOrder(
    request: EnterpriseCodingPlanCancelOrderRequest,
  ): Promise<EnterpriseCodingPlanCancelOrderResponse> {
    return this.post<EnterpriseCodingPlanCancelOrderResponse>(
      BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      `/subscription/enterprise/v2/order/${encodeURIComponent(request.orderNo)}/cancel`,
      {},
    );
  }

  async continueEnterpriseOrderPayment(
    request: EnterpriseCodingPlanContinuePayRequest,
  ): Promise<EnterpriseCodingPlanCreateOrderResponse> {
    return this.post<EnterpriseCodingPlanCreateOrderResponse>(
      BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      `/subscription/enterprise/v2/order/${encodeURIComponent(request.orderNo)}/pay`,
      {},
    );
  }

  async checkEnterpriseOrderStatus(
    request: EnterpriseCodingPlanOrderStatusRequest,
  ): Promise<EnterpriseCodingPlanOrderStatusResponse> {
    const url = new URL(
      `${resolveBigModelEnterpriseHost()}${BIGMODEL_CODING_PLAN_API_PREFIX}/subscription/enterprise/v2/order/${encodeURIComponent(request.orderNo)}/status`,
    );
    return this.get<EnterpriseCodingPlanOrderStatusResponse>(
      BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      url,
    );
  }

  private async post<T>(
    providerId: CodingPlanSubscriptionProviderId | undefined,
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const endpoint = await this.resolveEndpointConfig(providerId);
    const payload = await readCodingPlanApiJson<RemoteEnvelope<T>>(
      this.apiClient,
      `${endpoint.host}${BIGMODEL_CODING_PLAN_API_PREFIX}${path}`,
      {
        method: "POST",
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: endpoint.headers,
        body: JSON.stringify(dropUndefined(body)),
      },
    );
    return unwrapEnvelope(payload, endpoint.providerId);
  }

  private async get<T>(
    providerId: CodingPlanSubscriptionProviderId | undefined,
    url: URL,
  ): Promise<T> {
    const endpoint = await this.resolveEndpointConfig(providerId);
    const payload = await readCodingPlanApiJson<RemoteEnvelope<T>>(this.apiClient, url, {
      method: "GET",
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: endpoint.headers,
    });
    return unwrapEnvelope(payload, endpoint.providerId);
  }

  private async postZaiPay<T>(
    providerId: CodingPlanSubscriptionProviderId | undefined,
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const endpoint = await this.resolveEndpointConfig(providerId);
    assertZaiPaymentProvider(endpoint.providerId);
    const payload = await readCodingPlanApiJson<RemoteEnvelope<T>>(
      this.apiClient,
      `${endpoint.host}${ZAI_CODING_PLAN_PAY_API_PREFIX}${path}`,
      {
        method: "POST",
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: endpoint.headers,
        body: JSON.stringify(dropUndefined(body)),
      },
    );
    return unwrapEnvelope(payload, endpoint.providerId);
  }

  private async getZaiPay<T>(
    providerId: CodingPlanSubscriptionProviderId | undefined,
    path: string,
  ): Promise<T> {
    const endpoint = await this.resolveEndpointConfig(providerId);
    assertZaiPaymentProvider(endpoint.providerId);
    const payload = await readCodingPlanApiJson<RemoteEnvelope<T>>(
      this.apiClient,
      `${endpoint.host}${ZAI_CODING_PLAN_PAY_API_PREFIX}${path}`,
      {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: endpoint.headers,
      },
    );
    return unwrapEnvelope(payload, endpoint.providerId);
  }

  private async getClientConfigs(): Promise<CfClientConfigEnvelope> {
    if (this.clientConfigSnapshot && this.clientConfigSnapshotExpiresAt > Date.now()) {
      return this.clientConfigSnapshot;
    }
    if (this.clientConfigRequest) {
      return await this.clientConfigRequest;
    }

    const url = resolveCodingPlanClientConfigUrl(process.env);
    url.searchParams.set("app_version", CF_VERSION);
    url.searchParams.set("platform", resolveClientPlatformKey());
    this.clientConfigRequest = readCodingPlanApiJson<CfClientConfigEnvelope>(
      this.apiClient,
      url,
      {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
    );
    try {
      const payload = await this.clientConfigRequest;
      this.clientConfigSnapshot = payload;
      this.clientConfigSnapshotExpiresAt = Date.now() + CLIENT_CONFIG_CACHE_TTL_MS;
      return payload;
    } finally {
      this.clientConfigRequest = null;
    }
  }

  private async resolveEndpointConfig(
    providerId: CodingPlanSubscriptionProviderId | undefined,
  ): Promise<CodingPlanEndpointConfig> {
    const normalizedProviderId =
      providerId ?? BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
    if (isZaiCodingPlanProviderId(normalizedProviderId)) {
      const authorization = await this.loadZaiAuthorization();
      return {
        providerId: normalizedProviderId,
        host: resolveZaiCodingPlanHost(),
        headers: createZaiLoginAuthHeaders(authorization),
      };
    }

    const token = await this.loadBigModelAccessToken();
    return {
      providerId: normalizedProviderId,
      host: resolveBigModelApiOrigin(process.env),
      headers: createBigModelLoginAuthHeaders(token),
    };
  }

  private async loadBigModelAccessToken(): Promise<string> {
    const token = (
      await this.credentialService.load(`oauth:${BIGMODEL_PROVIDER_ID}:access_token`)
    )?.trim();
    if (!token) {
      throw new Error("bigmodel_oauth_required");
    }
    const cfJwtToken = (await this.credentialService.load(CF_JWT_TOKEN_KEY))?.trim();
    if (cfJwtToken && token === cfJwtToken) {
      log.warn(undefined, "BigModel access token is stale cf JWT; login required");
      throw new Error("bigmodel_oauth_required");
    }
    return token;
  }

  protected async enrichEnterprisePricingTeamProjects(
    response: EnterpriseCodingPlanPricingResponse,
  ): Promise<EnterpriseCodingPlanPricingResponse> {
    if (response.productList.length === 0) {
      return response;
    }
    const hasSubscribedProduct = response.productList.some(
      (product) => product.subscribed === true,
    );
    const hasSubscribedProductMissingProjectContext = response.productList.some(
      (product) =>
        product.subscribed === true &&
        (!product.projectId?.trim() || !product.organizationId?.trim()),
    );
    if (hasSubscribedProduct && !hasSubscribedProductMissingProjectContext) {
      const apiKeyStatuses = await this.ensureSubscribedTeamPlanProjectApiKeys(
        response,
        await this.loadFamilyEnterpriseToken(),
      );
      return applyTeamPlanProjectApiKeyStatuses(response, apiKeyStatuses);
    }

    const token = await this.loadFamilyEnterpriseToken();
    const host = this.resolveFamilyEnterpriseHost();
    const customerInfo = await readCodingPlanApiJson<RemoteEnvelope<BigModelCustomerInfoResponse>>(
      this.apiClient,
      `${host}${BIGMODEL_CODING_PLAN_API_PREFIX}/customer/getCustomerInfo`,
      {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: this.createFamilyEnterpriseAuthHeaders(token),
      },
    );
    const teamProjects = resolveBigModelTeamProjects(customerInfo.data);
    if (teamProjects.length === 0) {
      return response;
    }
    const fallbackSubscribedProductId = hasSubscribedProduct
      ? null
      : (resolveFallbackEnterpriseTeamPlanProduct(response.productList)?.productId ?? null);

    const enrichedResponse = {
      ...response,
      productList: response.productList.map((product) => {
        const shouldEnrichProduct =
          product.subscribed === true ||
          (fallbackSubscribedProductId !== null &&
            product.productId === fallbackSubscribedProductId);
        if (!shouldEnrichProduct) {
          return product;
        }
        const matchedTeamProjects = resolveProductTeamProjects(product, teamProjects);
        if (matchedTeamProjects.length === 0) {
          return product;
        }
        const primaryProject = matchedTeamProjects[0];
        return {
          ...product,
          organizationId: primaryProject?.organizationId ?? product.organizationId,
          organizationName: primaryProject?.organizationName ?? product.organizationName,
          projectId: primaryProject?.projectId ?? product.projectId,
          projectName: primaryProject?.projectName ?? product.projectName,
          teamProjects: matchedTeamProjects,
          subscribed: true,
        };
      }),
    };
    const apiKeyStatuses = await this.ensureSubscribedTeamPlanProjectApiKeys(
      enrichedResponse,
      token,
    );
    return applyTeamPlanProjectApiKeyStatuses(enrichedResponse, apiKeyStatuses);
  }

  protected async ensureSubscribedTeamPlanProjectApiKeys(
    response: EnterpriseCodingPlanPricingResponse,
    token: string,
  ): Promise<Map<string, TeamPlanProjectApiKeyPrewarmStatus>> {
    const teamContexts = collectSubscribedTeamPlanProjectContexts(response.productList);
    const statuses = new Map<string, TeamPlanProjectApiKeyPrewarmStatus>();
    if (teamContexts.length === 0) {
      return statuses;
    }
    const host = this.resolveFamilyEnterpriseHost();
    log.info(undefined, "Team Plan project api key prewarm started", {
      family: this.codingPlanProviderId(),
      teamProjectCount: teamContexts.length,
    });
    for (const teamContext of teamContexts) {
      try {
        const result = await ensureBigModelTeamPlanProjectApiKeyWithStatus({
          apiClient: this.apiClient,
          authorization: token,
          host,
          teamContext,
          timeoutMs: REQUEST_TIMEOUT_MS,
        });
        log.info(undefined, "Team Plan project api key prewarm result", {
          family: this.codingPlanProviderId(),
          diagnostics: result.diagnostics,
          organizationId: teamContext.organizationId,
          projectId: teamContext.projectId,
          status: result.status,
        });
        statuses.set(
          createTeamPlanProjectStatusKey(teamContext),
          createTeamPlanProjectApiKeyPrewarmStatusFromEnsureResult(result),
        );
      } catch (error) {
        log.warn(undefined, "Team Plan project api key prewarm failed", {
          family: this.codingPlanProviderId(),
          organizationId: teamContext.organizationId,
          projectId: teamContext.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
        statuses.set(createTeamPlanProjectStatusKey(teamContext), {
          status: "unavailable",
          reason: "request_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return statuses;
  }

  protected async loadZaiAuthorization(): Promise<string> {
    const token = (
      await this.credentialService.load(`oauth:${ZAI_PROVIDER_ID}:access_token`)
    )?.trim();
    if (!token) {
      throw new Error("zai_oauth_required");
    }

    return token;
  }
}

export function resolveCodingPlanClientConfigUrl(env: NodeJS.ProcessEnv): URL {
  return new URL(buildRuntimeCfApiUrl(env, CF_CLIENT_CONFIG_API_PREFIX));
}

function resolveFallbackEnterpriseTeamPlanProduct(
  products: EnterpriseCodingPlanPricingProduct[],
): EnterpriseCodingPlanPricingProduct | null {
  let selected: EnterpriseCodingPlanPricingProduct | null = null;
  let selectedScore = Number.NEGATIVE_INFINITY;
  for (const product of products) {
    const score = getEnterpriseTeamPlanFallbackProductScore(product);
    if (score > selectedScore) {
      selected = product;
      selectedScore = score;
    }
  }
  return selected;
}

function applyTeamPlanProjectApiKeyStatuses(
  response: EnterpriseCodingPlanPricingResponse,
  statuses: Map<string, TeamPlanProjectApiKeyPrewarmStatus>,
): EnterpriseCodingPlanPricingResponse {
  if (statuses.size === 0) {
    return response;
  }
  return {
    ...response,
    productList: response.productList.map((product) =>
      applyTeamPlanProjectApiKeyStatus(product, statuses),
    ),
  };
}

function applyTeamPlanProjectApiKeyStatus(
  product: EnterpriseCodingPlanPricingProduct,
  statuses: Map<string, TeamPlanProjectApiKeyPrewarmStatus>,
): EnterpriseCodingPlanPricingProduct {
  const teamProjects = product.teamProjects?.map((project) =>
    applyTeamPlanProjectContextApiKeyStatus(project, statuses),
  );
  const productStatus = getTeamPlanProjectApiKeyStatus(
    {
      organizationId: product.organizationId ?? "",
      projectId: product.projectId ?? "",
    },
    statuses,
  );
  return {
    ...product,
    ...(teamProjects ? { teamProjects } : {}),
    ...(productStatus ? createTeamPlanProjectApiKeyStatusFields(productStatus) : {}),
  };
}

function applyTeamPlanProjectContextApiKeyStatus(
  project: EnterpriseCodingPlanProjectContext,
  statuses: Map<string, TeamPlanProjectApiKeyPrewarmStatus>,
): EnterpriseCodingPlanProjectContext {
  const status = getTeamPlanProjectApiKeyStatus(project, statuses);
  if (!status) {
    return project;
  }
  return {
    ...project,
    ...createTeamPlanProjectApiKeyStatusFields(status),
  };
}

function createTeamPlanProjectApiKeyStatusFields(
  status: TeamPlanProjectApiKeyPrewarmStatus,
): Pick<
  EnterpriseCodingPlanProjectContext,
  "apiKeyStatus" | "apiKeyUnavailableReason" | "apiKeyUnavailableMessage"
> {
  return {
    apiKeyStatus: status.status,
    apiKeyUnavailableReason: status.status === "unavailable" ? (status.reason ?? null) : null,
    apiKeyUnavailableMessage: status.status === "unavailable" ? (status.message ?? null) : null,
  };
}

function getTeamPlanProjectApiKeyStatus(
  project: Pick<EnterpriseCodingPlanProjectContext, "organizationId" | "projectId">,
  statuses: Map<string, TeamPlanProjectApiKeyPrewarmStatus>,
): TeamPlanProjectApiKeyPrewarmStatus | null {
  const organizationId = project.organizationId?.trim() ?? "";
  const projectId = project.projectId?.trim() ?? "";
  if (!organizationId || !projectId) {
    return null;
  }
  return statuses.get(createTeamPlanProjectStatusKey({ organizationId, projectId })) ?? null;
}

function createTeamPlanProjectApiKeyPrewarmStatusFromEnsureResult(
  result: BigModelTeamPlanApiKeyEnsureResult,
): TeamPlanProjectApiKeyPrewarmStatus {
  if (result.apiKey) {
    return { status: "available" };
  }
  return {
    status: "unavailable",
    reason: isNoValidTeamPlanAuthorizationMessage(result.diagnostics.create?.msg)
      ? "no_valid_team_plan_authorization"
      : "request_failed",
    message: result.diagnostics.create?.msg ?? result.diagnostics.list.msg ?? null,
  };
}

function createTeamPlanProjectStatusKey(
  project: Pick<EnterpriseCodingPlanProjectContext, "organizationId" | "projectId">,
): string {
  return `${project.organizationId.trim()}:${project.projectId.trim()}`;
}

function isNoValidTeamPlanAuthorizationMessage(message: string | null | undefined): boolean {
  return Boolean(message?.includes("暂无有效的团队套餐授权记录"));
}

function getEnterpriseTeamPlanFallbackProductScore(
  product: EnterpriseCodingPlanPricingProduct,
): number {
  let score = 0;
  if (product.tier === "PRO") {
    score += 100;
  }
  if (product.subscribeMode === "ONE_TIME") {
    score += 20;
  }
  if (product.subscribePeriod === "MONTHLY") {
    score += 10;
  }
  return score;
}

function resolveProductTeamProjects(
  product: EnterpriseCodingPlanPricingProduct,
  teamProjects: EnterpriseCodingPlanProjectContext[],
): EnterpriseCodingPlanProjectContext[] {
  const organizationId = product.organizationId?.trim() ?? "";
  const projectId = product.projectId?.trim() ?? "";
  return teamProjects.filter((project) => {
    if (organizationId && project.organizationId !== organizationId) {
      return false;
    }
    if (projectId && project.projectId !== projectId) {
      return false;
    }
    return true;
  });
}

function collectSubscribedTeamPlanProjectContexts(
  products: readonly EnterpriseCodingPlanPricingProduct[],
): BigModelTeamPlanBizContext[] {
  const result: BigModelTeamPlanBizContext[] = [];
  const seen = new Set<string>();
  for (const product of products) {
    if (product.subscribed !== true) {
      continue;
    }
    const projectContexts =
      product.teamProjects && product.teamProjects.length > 0
        ? product.teamProjects
        : [
            {
              organizationId: product.organizationId ?? null,
              projectId: product.projectId ?? null,
            },
          ];
    for (const projectContext of projectContexts) {
      const organizationId = projectContext.organizationId?.trim() ?? "";
      const projectId = projectContext.projectId?.trim() ?? "";
      if (!organizationId || !projectId) {
        continue;
      }
      const key = `${organizationId}\0${projectId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push({ organizationId, projectId });
    }
  }
  return result;
}

function resolveBigModelTeamProjects(
  customerInfo: BigModelCustomerInfoResponse | null | undefined,
): EnterpriseCodingPlanProjectContext[] {
  const result: EnterpriseCodingPlanProjectContext[] = [];
  for (const organization of customerInfo?.organizations ?? []) {
    const organizationId = organization.organizationId?.trim() ?? "";
    if (!organizationId) {
      continue;
    }
    for (const project of organization.projects ?? []) {
      const projectId = project.projectId?.trim() ?? "";
      if (!projectId || !isBigModelTeamCodingPlanProject(project)) {
        continue;
      }
      result.push({
        organizationId,
        organizationName: organization.organizationName ?? null,
        projectId,
        projectName: project.projectName ?? null,
      });
    }
  }
  return result;
}

function isBigModelTeamCodingPlanProject(
  project: NonNullable<
    NonNullable<BigModelCustomerInfoResponse["organizations"]>[number]["projects"]
  >[number],
): boolean {
  return String(project.projectType ?? "").trim() === "2";
}

export function createBigModelLoginAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: token,
    "Content-Type": "application/json",
  };
}

export function createZaiLoginAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: token,
    "Content-Type": "application/json",
  };
}

function resolveCodingPlanHost(providerId: CodingPlanSubscriptionProviderId | undefined): string {
  return providerId && isZaiCodingPlanProviderId(providerId)
    ? resolveZaiCodingPlanHost()
    : resolveBigModelApiOrigin(process.env);
}

function resolveZaiCodingPlanHost(): string {
  return resolveZaiBusinessBaseUrl(process.env);
}

function resolveBigModelEnterpriseHost(): string {
  return resolveBigModelApiOrigin(process.env);
}

function resolvePreviewPath(providerId: CodingPlanSubscriptionProviderId | undefined): string {
  return providerId && isZaiCodingPlanProviderId(providerId) ? "/pay/zai-preview" : "/pay/preview";
}

function assertZaiPaymentProvider(providerId: CodingPlanSubscriptionProviderId): void {
  if (!isZaiCodingPlanProviderId(providerId)) {
    throw new Error(CODING_PLAN_ZAI_OVERSEAS_PAYMENT_REQUIRED);
  }
}

function unwrapEnvelope<T>(
  payload: RemoteEnvelope<T>,
  providerId: CodingPlanSubscriptionProviderId,
): T {
  if (payload.code !== undefined && payload.code !== 200) {
    throw new Error(normalizeRemoteErrorMessage(payload.msg, providerId, payload.code));
  }
  if (payload.success === false) {
    throw new Error(normalizeRemoteErrorMessage(payload.msg, providerId));
  }
  if (payload.data === null || payload.data === undefined) {
    const providerName = resolveCodingPlanProviderName(providerId);
    throw new Error(payload.msg?.trim() || `${providerName} response missing data`);
  }
  return payload.data;
}

function normalizeStaticProductProviderIds<T>(
  products: Partial<Record<CodingPlanSubscriptionProviderId, T[]>>,
): Partial<Record<CodingPlanSubscriptionProviderId, T[]>> {
  const normalized = { ...products };
  const raw = products as Record<string, T[]>;
  for (const [legacyId, currentId] of [
    ["builtin:bigmodel-coding-plan", BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan],
    ["builtin:zai-coding-plan", BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan],
  ] as const) {
    if (Object.hasOwn(raw, legacyId)) normalized[currentId] = raw[legacyId];
    delete (normalized as Record<string, T[]>)[legacyId];
  }
  return normalized;
}

function unwrapClientConfigProducts(
  payload: CfClientConfigEnvelope,
): CodingPlanStaticProductsConfig {
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(payload.msg?.trim() || "CodeFusion client config request failed");
  }
  const products = payload.data?.configs?.codingPlanStaticProducts;
  if (!products || typeof products !== "object") {
    throw new Error("CodeFusion client config missing Coding Plan products");
  }
  return normalizeStaticProductProviderIds(products);
}

function unwrapClientConfigTeamProducts(
  payload: CfClientConfigEnvelope,
): CodingPlanStaticTeamProductsConfig {
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(payload.msg?.trim() || "CodeFusion client config request failed");
  }
  const products: unknown = payload.data?.configs?.codingPlanStaticTeamProducts;
  if (!products || typeof products !== "object") {
    throw new Error("CodeFusion client config missing Coding Plan team products");
  }
  for (const providerProducts of Object.values(products)) {
    if (
      !Array.isArray(providerProducts) ||
      !providerProducts.every(isCodingPlanStaticTeamProduct)
    ) {
      throw new Error("CodeFusion client config has invalid Coding Plan team products");
    }
  }
  return normalizeStaticProductProviderIds(products as CodingPlanStaticTeamProductsConfig);
}

function isCodingPlanStaticTeamProduct(value: unknown): value is CodingPlanStaticTeamProduct {
  if (!value || typeof value !== "object") {
    return false;
  }
  const product = value as Record<string, unknown>;
  return (
    isNonEmptyString(product.productId) &&
    isNonEmptyString(product.productName) &&
    (product.tier === "LITE" || product.tier === "PRO" || product.tier === "MAX") &&
    (product.subscribeMode === "CONTINUOUS" || product.subscribeMode === "ONE_TIME") &&
    (product.subscribePeriod === "MONTHLY" ||
      product.subscribePeriod === "QUARTERLY" ||
      product.subscribePeriod === "YEARLY") &&
    isNonEmptyString(product.purchaseMethodName) &&
    product.priceCurrency === "CNY" &&
    isValidCardCopyConfig(product.equity) &&
    isValidCardCopyConfig(product.description)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidCardCopyConfig(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(isValidCardCopyConfigItem));
}

function isValidCardCopyConfigItem(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    isNonEmptyString(item.text) && (item.tooltip === undefined || typeof item.tooltip === "string")
  );
}

function unwrapClientConfigBillingDiscount(
  payload: CfClientConfigEnvelope,
): CodingPlanBillingDiscountConfig | undefined {
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(payload.msg?.trim() || "CodeFusion client config request failed");
  }
  const configs = payload.data?.configs;
  if (!configs || !("codingPlanBillingDiscount" in configs)) {
    return undefined;
  }
  return configs.codingPlanBillingDiscount;
}

function unwrapClientConfigStartPlanPreview(
  payload: CfClientConfigEnvelope,
): StartPlanPreviewConfig | null {
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(payload.msg?.trim() || "CodeFusion client config request failed");
  }
  const preview = payload.data?.configs?.startPlanPreview;
  if (!preview) {
    return null;
  }
  if (
    typeof preview.planId !== "string" ||
    typeof preview.name !== "string" ||
    !Array.isArray(preview.entitlements)
  ) {
    throw new Error("CodeFusion client config invalid Start Plan preview");
  }
  return {
    planId: preview.planId,
    name: preview.name,
    entitlements: preview.entitlements.filter(isValidStartPlanPreviewEntitlement),
  };
}

function unwrapClientConfigForceUpdate(
  payload: CfClientConfigEnvelope,
): ForceUpdateConfig | null {
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(payload.msg?.trim() || "CodeFusion client config request failed");
  }

  const forceUpdate = payload.data?.configs?.forceUpdate;
  if (!forceUpdate) {
    return null;
  }

  const minimalVersion = forceUpdate.minimalVersion;
  if (typeof minimalVersion !== "string" || minimalVersion.trim() === "") {
    return null;
  }

  return { minimalVersion: minimalVersion.trim() };
}

function isValidStartPlanPreviewEntitlement(
  entitlement: StartPlanPreviewConfig["entitlements"][number],
): boolean {
  return (
    typeof entitlement?.grantUnits === "number" &&
    typeof entitlement.meter === "string" &&
    typeof entitlement.period === "string" &&
    typeof entitlement.showName === "string" &&
    typeof entitlement.unitType === "string"
  );
}

function resolveClientPlatformKey(): string {
  return `${process.platform}-${process.arch}`;
}

function normalizeRemoteErrorMessage(
  msg: string | undefined,
  providerId: CodingPlanSubscriptionProviderId,
  code?: number,
) {
  const message = msg?.trim();
  if (message && isUnrenderableRemoteErrorMessage(message)) {
    return CODING_PLAN_SYSTEM_BUSY;
  }
  if (message && isRequestVerificationMessage(message)) {
    return REQUEST_VERIFICATION_REQUIRED;
  }
  const providerName = resolveCodingPlanProviderName(providerId);
  return message || `${providerName} request failed${code ? `: ${code}` : ""}`;
}

async function readCodingPlanApiJson<T>(
  apiClient: ApiClient,
  input: string | URL,
  init?: ApiRequestInit,
): Promise<T> {
  try {
    return await readApiJson<T>(apiClient, input, init);
  } catch (error) {
    const message = readRemoteErrorMessage(error);
    if (isUnrenderableRemoteErrorMessage(message)) {
      throw new Error(CODING_PLAN_SYSTEM_BUSY);
    }
    throw error;
  }
}

function readRemoteErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(error);
}

function isUnrenderableRemoteErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("<!doctype") ||
    /<\s*(html|head|body|script|style|title|meta)\b/.test(normalized) ||
    normalized.includes("errors.aliyun.com") ||
    normalized.includes("request has been blocked") ||
    normalized.includes("unexpected token '<'") ||
    normalized.includes("unexpected end of json input") ||
    normalized.includes("invalid json response")
  );
}

function resolveCodingPlanProviderName(providerId: CodingPlanSubscriptionProviderId): string {
  return isZaiCodingPlanProviderId(providerId) ? "Z.ai" : "BigModel";
}

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function resolveOffPeakClientConfig(
  payload: CfClientConfigEnvelope,
  env: NodeJS.ProcessEnv,
  modelSelectionView: ModelSelectionView = EMPTY_OFF_PEAK_MODEL_SELECTION_VIEW,
): OffPeakClientConfig {
  const hasModels = modelSelectionView.providers.some((provider) => provider.models.length > 0);
  if (env["CF_OFFPEAK_MOCK"] === "1") {
    return {
      enabled: hasModels,
      modelSelectionView,
      codingPlanActive: env["CF_OFFPEAK_MOCK_NO_PLAN"] !== "1",
    };
  }
  const raw = payload.data?.configs?.offPeak;
  return {
    enabled: raw?.enable_offpeak_task === true && hasModels,
    modelSelectionView,
  };
}

const EMPTY_OFF_PEAK_MODEL_SELECTION_VIEW: ModelSelectionView = Object.freeze({
  revision: 0,
  providers: Object.freeze([]),
});
