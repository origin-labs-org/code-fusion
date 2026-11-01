import {
  BIGMODEL_PROVIDER_ID,
  BUILTIN_MODEL_PROVIDER_IDS,
  getModelProviderFamilySpec,
  ZAI_PROVIDER_ID,
  type UsageEntitlementSnapshot,
} from "@origin-ai/cf-shared";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { describe, expect, it } from "vitest";
import {
  buildVisibleFamilyConnectionItems,
  buildVisibleFamilyConnectionKeys,
  resolveCodingPlanEntitlementState,
} from "@/settings/model-provider-section/providerFamilyConnectionVisibility.js";
import {
  CODING_PLAN_PROVIDER_SPECS,
  type CodingPlanStatus,
  type ModelProviderNavGroup,
} from "@/settings/model-provider-section/constants.js";

type ProviderOverrides = Partial<ProviderSettingsFormProvider> & {
  id?: string;
  name?: string;
  apiKey?: string;
  models?: string[];
};

it("待生效套餐可查看订阅，不借 entitled 点亮执行资格", () => {
  const result = resolveCodingPlanEntitlementState({
    providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
    accountEntitled: false,
    accountAvailability: "pending",
    modelProvidersLoading: false,
    entitlement: {
      loading: false,
      error: null,
      snapshot: {
        subscription: {
          details: [{ productId: "start", productName: "Start Plan", effectiveAt: 2000 }],
        },
      } as UsageEntitlementSnapshot,
    },
  });
  expect(result.status).toBe("purchased");
  expect(result.currentProductId).toBe("start");
});

it("Show Not Activated instead of Not Connected when logged in but server explicitly indicates no personal subscription", () => {
  const result = resolveCodingPlanEntitlementState({
    providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    accountEntitled: false,
    accountAvailability: "unavailable",
    accountUnavailableReason: "not-entitled",
    modelProvidersLoading: false,
  });
  expect(result.status).toBe("notPurchased");
});

it("Show Fetch Failed when credentials expire, neither Not Connected nor Not Activated", () => {
  const result = resolveCodingPlanEntitlementState({
    providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    accountEntitled: false,
    accountAvailability: "unavailable",
    accountUnavailableReason: "credential-failed",
    modelProvidersLoading: false,
  });
  expect(result.status).toBe("unavailable");
});

it.each(["not-connected", "not-authenticated", undefined] as const)(
  "Still show Not Connected when disconnected / not logged in / reason missing (%s)",
  (accountUnavailableReason) => {
    const result = resolveCodingPlanEntitlementState({
      providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      accountEntitled: false,
      accountAvailability: "unavailable",
      accountUnavailableReason,
      modelProvidersLoading: false,
    });
    expect(result.status).toBe("disconnected");
  },
);

it("原因未知时保持未连接，不把网络抖动当成未开通", () => {
  const result = resolveCodingPlanEntitlementState({
    providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    accountEntitled: false,
    accountAvailability: "unknown",
    accountUnavailableReason: "not-entitled",
    modelProvidersLoading: false,
  });
  expect(result.status).toBe("disconnected");
});

it.each([
  BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
  BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
] as const)("Show No Plan for Start Plan when explicitly lacking entitlement (%s)", (providerId) => {
  const result = resolveCodingPlanEntitlementState({
    providerId,
    accountEntitled: false,
    accountAvailability: "unavailable",
    accountUnavailableReason: "not-entitled",
    modelProvidersLoading: false,
  });
  expect(result.status).toBe("notPurchased");
});

it("Symmetrical check between Z.AI personal plans and server lack of entitlement", () => {
  const result = resolveCodingPlanEntitlementState({
    providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
    accountEntitled: false,
    accountAvailability: "unavailable",
    accountUnavailableReason: "not-entitled",
    modelProvidersLoading: false,
  });
  expect(result.status).toBe("notPurchased");
});

function createProvider(overrides: ProviderOverrides): ProviderSettingsFormProvider {
  const providerId =
    overrides.providerId ?? overrides.id ?? BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan;
  const modelIds = overrides.models ?? ["glm-5"];
  return {
    providerId,
    executable: overrides.executable ?? true,
    enabled: overrides.enabled ?? true,
    hasPersonalConfig: false,
    personalConfig: {},
    config: {
      label: overrides.name ?? "BigModel",
      access: { type: "api-key", apiKey: overrides.apiKey ?? "sk-test" },
      api: { type: "anthropic-messages", baseUrl: "https://example.com" },
      builtinModelIds: modelIds,
      enabled: overrides.enabled ?? true,
      ...overrides.config,
    },
    models: modelIds.map((modelId) => ({
      kind: "candidate" as const,
      modelId,
      builtin: true,
      personalConfig: {},
      config: {},
      hasPersonalConfig: false,
      executable: true,
      selectable: true,
    })),
  };
}

function createCodingPlanItem(
  status: "notPurchased" | "purchased",
): Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }> {
  return {
    key: `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan}`,
    type: "codingPlan",
    presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    oauthProviderId: BIGMODEL_PROVIDER_ID,
    label: "BigModel - Coding Plan",
    providerName: "BigModel",
    provider: createProvider({
      id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      name: "BigModel - Coding Plan",
    }),
    status,
    statusActive: status === "purchased",
    subscriptionRenewTime: "2026-09-15T00:00:00.000Z",
    subscriptionBillingCycle: "monthly",
  };
}

function createStartPlanItem(
  status: CodingPlanStatus,
): Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }> {
  return {
    ...createCodingPlanItem(status === "purchased" ? "purchased" : "notPurchased"),
    key: `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan}`,
    presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
    label: "BigModel - Start Plan",
    provider: createProvider({
      id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
      name: "BigModel - Start Plan",
    }),
    status,
    statusActive: status === "purchased",
  };
}

function createNoTeamQuotaEntitlementSnapshot(): UsageEntitlementSnapshot {
  return {
    generatedAt: 1,
    authenticated: true,
    context: {
      scope: "team",
      organizationId: "org-a",
      projectId: "project-a",
      productId: "product-team",
      displayName: "Org A",
    },
    provider: {
      id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      name: "BigModel - Coding Plan",
    },
    remaining: null,
    quota: null,
    subscription: null,
    unavailableReason: "no_plan",
  };
}

describe("buildVisibleFamilyConnectionKeys", () => {
  it("Retain both connection entries when Start and Personal Coding are both active", () => {
    const items = buildVisibleFamilyConnectionItems({
      items: [createCodingPlanItem("purchased"), createStartPlanItem("purchased")],
      subscribedTeamProducts: [],
      showPurchasedTeamPlanFallback: false,
    });

    expect(items.map((item) => item.key)).toEqual([
      `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan}`,
      `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan}`,
    ]);
  });

  it("Retain Start connection entry when Start and Team Plan are both active", () => {
    const items = buildVisibleFamilyConnectionItems({
      items: [createCodingPlanItem("notPurchased"), createStartPlanItem("purchased")],
      subscribedTeamProducts: [
        {
          productId: "team-pro",
          productName: "Team Pro",
          productBigTitle: "Team Pro",
          originalAmount: 598,
          payAmount: 598,
          priceUnit: "year",
          priceCurrency: "CNY",
          productEquityList: [],
          hasPreview: true,
          enterpriseProduct: {
            productId: "team-pro",
            tier: "PRO",
            subscribeMode: "CONTINUOUS",
            subscribePeriod: "YEARLY",
            subscribed: true,
            organizationId: "org-a",
            organizationName: "Org A",
            projectId: "project-a",
            projectName: "Project A",
          },
          tier: "PRO",
          subscribeMode: "CONTINUOUS",
          subscribePeriod: "YEARLY",
          purchaseMethodName: "yearly",
          subscribed: true,
          organizationId: "org-a",
          organizationName: "Org A",
          projectId: "project-a",
          projectName: "Project A",
        },
      ],
      showPurchasedTeamPlanFallback: false,
    });

    expect(items.map((item) => item.key)).toContain(
      `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan}`,
    );
    expect(items.some((item) => item.type === "teamPlan")).toBe(true);
  });

  it("Retain entry when selected Start is temporarily unavailable; hide when explicitly lacking entitlement", () => {
    const selectedConnectionKey = `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan}`;
    const common = {
      subscribedTeamProducts: [],
      showPurchasedTeamPlanFallback: false,
      connectionSelections: { bigmodel: { kind: "start-plan" } } as const,
    };

    expect(
      buildVisibleFamilyConnectionItems({
        ...common,
        items: [createCodingPlanItem("purchased"), createStartPlanItem("unavailable")],
      }).map((item) => item.key),
    ).toContain(selectedConnectionKey);
    expect(
      buildVisibleFamilyConnectionItems({
        ...common,
        items: [createCodingPlanItem("purchased"), createStartPlanItem("notPurchased")],
      }).map((item) => item.key),
    ).not.toContain(selectedConnectionKey);
  });

  it("Retain Coding Plan purchased status by API Key and entitlement even after all models are deleted", () => {
    const provider = createProvider({
      id: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      apiKey: "coding-plan-key",
      models: [],
    });

    expect(
      resolveCodingPlanEntitlementState({
        providerId: provider.providerId,
        accountEntitled: true,
        modelProvidersLoading: false,
        entitlement: {
          loading: false,
          error: null,
          snapshot: {
            generatedAt: 1,
            authenticated: true,
            provider: {
              id: provider.providerId,
              name: provider.config.label ?? provider.providerId,
            },
            remaining: null,
            quota: null,
            subscription: {
              identityType: "email",
              identityMasked: "u***@example.com",
              details: [
                {
                  productId: "coding-lite",
                  productName: "GLM Coding Lite",
                  purchaseTime: null,
                  beginTime: null,
                  expireTime: null,
                },
              ],
            },
          },
        },
      }).status,
    ).toBe("purchased");
  });

  it.each(["not_authenticated", "not_configured", "unavailable"] as const)(
    "When account is connected, %s entitlement snapshot will not be falsely reported as unpurchased",
    (unavailableReason) => {
      expect(
        resolveCodingPlanEntitlementState({
          providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
          accountEntitled: true,
          modelProvidersLoading: false,
          entitlement: {
            loading: false,
            error: null,
            snapshot: {
              generatedAt: 1,
              authenticated: unavailableReason !== "not_authenticated",
              provider: null,
              remaining: null,
              quota: null,
              subscription: null,
              unavailableReason,
            },
          },
        }).status,
      ).toBe("unavailable");
    },
  );

  it("BigModel 个人套餐管理入口使用当前环境的个人套餐页", () => {
    const bigmodelSpecs = CODING_PLAN_PROVIDER_SPECS.filter(
      (item) =>
        item.id === BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan ||
        item.id === BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
    );

    expect(bigmodelSpecs.map((item) => item.purchaseUrl)).toEqual([
      "https://bigmodel.cn/coding-plan/personal/overview",
      "https://bigmodel.cn/coding-plan/personal/overview",
    ]);
  });

  it("Keep unpurchased Coding Plan in input connection methods", () => {
    const keys = buildVisibleFamilyConnectionKeys({
      items: [createCodingPlanItem("notPurchased")],
      subscribedTeamProducts: [],
      showPurchasedTeamPlanFallback: false,
      modelProviders: [
        createProvider({
          id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
          apiKey: "",
          models: ["glm-api-key"],
        }),
      ],
    });

    expect([...keys]).toEqual([
      `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan}`,
    ]);
  });

  it("Purchased Coding Plan will be added to input connection methods", () => {
    const keys = buildVisibleFamilyConnectionKeys({
      items: [createCodingPlanItem("purchased")],
      subscribedTeamProducts: [],
      showPurchasedTeamPlanFallback: false,
      modelProviders: [
        createProvider({
          id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
          apiKey: "sk-api",
          models: ["glm-api-key"],
        }),
      ],
    });

    expect([...keys]).toEqual([
      `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan}`,
    ]);
  });

  it("Team Plan 管理入口使用当前环境的团队套餐列表页", () => {
    const items = buildVisibleFamilyConnectionItems({
      items: [
        {
          ...createCodingPlanItem("purchased"),
          purchaseUrl: "https://bigmodel.cn/coding-plan/personal/overview",
        },
      ],
      subscribedTeamProducts: [
        {
          productId: "product-team",
          productName: "GLM Coding Team",
          productBigTitle: "GLM Coding Team",
          originalAmount: 598,
          payAmount: 598,
          priceUnit: "year",
          priceCurrency: "CNY",
          productEquityList: [],
          hasPreview: true,
          enterpriseProduct: {
            productId: "product-team",
            tier: "PRO",
            subscribeMode: "CONTINUOUS",
            subscribePeriod: "YEARLY",
            subscribed: true,
            organizationId: "org-a",
            organizationName: "Org A",
            projectId: "project-a",
            projectName: "Project A",
          },
          tier: "PRO",
          subscribeMode: "CONTINUOUS",
          subscribePeriod: "YEARLY",
          purchaseMethodName: "yearly",
          subscribed: true,
          organizationId: "org-a",
          organizationName: "Org A",
          projectId: "project-a",
          projectName: "Project A",
        },
      ],
      showPurchasedTeamPlanFallback: false,
    });

    const teamItem = items.find((item) => item.type === "teamPlan");
    expect(teamItem?.purchaseUrl).toBe("https://bigmodel.cn/coding-plan/team/plans");
    expect(teamItem?.teamPlanName).toBe("Org A");
    expect(teamItem?.planLevel).toBe("Org A");
  });

  it("Do not generate empty Team Plan connection entry when organization name is missing", () => {
    const items = buildVisibleFamilyConnectionItems({
      items: [createCodingPlanItem("purchased")],
      subscribedTeamProducts: [
        {
          productId: "product-team",
          productName: "GLM Coding Team",
          productBigTitle: "GLM Coding Team",
          originalAmount: 598,
          payAmount: 598,
          priceUnit: "year",
          priceCurrency: "CNY",
          productEquityList: [],
          hasPreview: true,
          enterpriseProduct: {
            productId: "product-team",
            tier: "PRO",
            subscribeMode: "CONTINUOUS",
            subscribePeriod: "YEARLY",
            subscribed: true,
            organizationId: "org-a",
            organizationName: null,
            projectId: "project-a",
            projectName: "Project A",
          },
          tier: "PRO",
          subscribeMode: "CONTINUOUS",
          subscribePeriod: "YEARLY",
          purchaseMethodName: "yearly",
          subscribed: true,
          organizationId: "org-a",
          organizationName: null,
          projectId: "project-a",
          projectName: "Project A",
        },
      ],
      showPurchasedTeamPlanFallback: false,
    });

    expect(items.some((item) => item.type === "teamPlan")).toBe(false);
  });

  it("Retain connection entry but mark as unavailable when Team Plan project key is unavailable", () => {
    const items = buildVisibleFamilyConnectionItems({
      items: [createCodingPlanItem("purchased")],
      subscribedTeamProducts: [
        {
          productId: "product-team",
          productName: "GLM Coding Team",
          productBigTitle: "GLM Coding Team",
          originalAmount: 598,
          payAmount: 598,
          priceUnit: "year",
          priceCurrency: "CNY",
          productEquityList: [],
          hasPreview: true,
          enterpriseProduct: {
            productId: "product-team",
            tier: "PRO",
            subscribeMode: "CONTINUOUS",
            subscribePeriod: "YEARLY",
            subscribed: true,
            teamProjects: [
              {
                organizationId: "org-a",
                organizationName: "Org A",
                projectId: "project-a",
                projectName: "Project A",
                apiKeyStatus: "unavailable",
                apiKeyUnavailableReason: "no_valid_team_plan_authorization",
              },
            ],
          },
          tier: "PRO",
          subscribeMode: "CONTINUOUS",
          subscribePeriod: "YEARLY",
          purchaseMethodName: "yearly",
          subscribed: true,
          teamProjects: [
            {
              organizationId: "org-a",
              organizationName: "Org A",
              projectId: "project-a",
              projectName: "Project A",
              apiKeyStatus: "unavailable",
              apiKeyUnavailableReason: "no_valid_team_plan_authorization",
            },
          ],
        },
      ],
      showPurchasedTeamPlanFallback: false,
    });

    const teamItem = items.find((item) => item.type === "teamPlan");
    expect(teamItem).toMatchObject({
      key: `team:bigmodel:product-team:org-a:project-a`,
      status: "unavailable",
      statusActive: false,
      availabilityReason: "credential-unavailable",
      statusLabelId: undefined,
      inactivePlanTitle: "Org A",
      teamPlanName: "Org A",
    });
  });

  it("Team Plan quota 权益失败时不继承个人续费日期且不点亮", () => {
    const items = buildVisibleFamilyConnectionItems({
      items: [createCodingPlanItem("purchased")],
      codingPlanEntitlements: {
        [BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan]: {
          loading: false,
          error: null,
          snapshot: createNoTeamQuotaEntitlementSnapshot(),
          refresh: async () => {},
        },
      },
      subscribedTeamProducts: [
        {
          productId: "product-team",
          productName: "GLM Coding Team",
          productBigTitle: "GLM Coding Team",
          originalAmount: 598,
          payAmount: 598,
          priceUnit: "year",
          priceCurrency: "CNY",
          productEquityList: [],
          hasPreview: true,
          enterpriseProduct: {
            productId: "product-team",
            tier: "PRO",
            subscribeMode: "CONTINUOUS",
            subscribePeriod: "YEARLY",
            subscribed: true,
            teamProjects: [
              {
                organizationId: "org-a",
                organizationName: "Org A",
                projectId: "project-a",
                projectName: "Project A",
                apiKeyStatus: "available",
              },
            ],
          },
          tier: "PRO",
          subscribeMode: "CONTINUOUS",
          subscribePeriod: "YEARLY",
          purchaseMethodName: "yearly",
          subscribed: true,
          teamProjects: [
            {
              organizationId: "org-a",
              organizationName: "Org A",
              projectId: "project-a",
              projectName: "Project A",
              apiKeyStatus: "available",
            },
          ],
        },
      ],
      showPurchasedTeamPlanFallback: false,
    });

    const teamItem = items.find((item) => item.type === "teamPlan");
    expect(teamItem).toMatchObject({
      status: "unavailable",
      statusActive: false,
      statusLabelId: "settings.modelProvider.codingPlan.status.teamUnavailable",
    });
    expect(teamItem).toMatchObject({
      subscriptionRenewTime: null,
      subscriptionBillingCycle: null,
    });
  });

  it("Do not prematurely mark as unassigned while Team Plan quota is loading or request errors", () => {
    for (const entitlement of [
      { loading: true, error: null },
      { loading: false, error: new Error("network failed") },
    ]) {
      const items = buildVisibleFamilyConnectionItems({
        items: [createCodingPlanItem("purchased")],
        codingPlanEntitlements: {
          [BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan]: {
            ...entitlement,
            snapshot: createNoTeamQuotaEntitlementSnapshot(),
            refresh: async () => {},
          },
        },
        subscribedTeamProducts: [
          {
            productId: "product-team",
            productName: "GLM Coding Team",
            productBigTitle: "GLM Coding Team",
            originalAmount: 598,
            payAmount: 598,
            priceUnit: "year",
            priceCurrency: "CNY",
            productEquityList: [],
            hasPreview: true,
            enterpriseProduct: {
              productId: "product-team",
              tier: "PRO",
              subscribeMode: "CONTINUOUS",
              subscribePeriod: "YEARLY",
              subscribed: true,
              teamProjects: [
                {
                  organizationId: "org-a",
                  organizationName: "Org A",
                  projectId: "project-a",
                  projectName: "Project A",
                  apiKeyStatus: "available",
                },
              ],
            },
            tier: "PRO",
            subscribeMode: "CONTINUOUS",
            subscribePeriod: "YEARLY",
            purchaseMethodName: "yearly",
            subscribed: true,
            teamProjects: [
              {
                organizationId: "org-a",
                organizationName: "Org A",
                projectId: "project-a",
                projectName: "Project A",
                apiKeyStatus: "available",
              },
            ],
          },
        ],
        showPurchasedTeamPlanFallback: false,
      });

      const teamItem = items.find((item) => item.type === "teamPlan");
      expect(teamItem?.statusLabelId).not.toBe(
        "settings.modelProvider.codingPlan.status.teamUnavailable",
      );
    }
  });

  it("Prioritize using entitlement snapshot team context to generate Team Plan connection entry", () => {
    const items = buildVisibleFamilyConnectionItems({
      items: [createCodingPlanItem("purchased")],
      codingPlanEntitlements: {
        [BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan]: {
          loading: false,
          error: null,
          snapshot: {
            generatedAt: 1,
            authenticated: true,
            context: {
              scope: "team",
              organizationId: "org-snapshot",
              projectId: "project-snapshot",
              productId: "product-snapshot",
              displayName: "Snapshot Team",
            },
            provider: {
              id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
              name: "BigModel - Coding Plan",
            },
            remaining: null,
            subscription: null,
            quota: null,
          },
        },
      },
      subscribedTeamProducts: [],
      showPurchasedTeamPlanFallback: false,
    });

    const teamItem = items.find((item) => item.type === "teamPlan");
    expect(teamItem?.key).toBe(`team:bigmodel:product-snapshot:org-snapshot:project-snapshot`);
    expect(teamItem?.teamPlanName).toBe("Snapshot Team");
    expect(teamItem?.organizationId).toBe("org-snapshot");
    expect(teamItem?.projectId).toBe("project-snapshot");
  });

  it("enterprise products only correct metadata of same-project Team Plan generated by entitlement", () => {
    const items = buildVisibleFamilyConnectionItems({
      items: [createCodingPlanItem("purchased")],
      codingPlanEntitlements: {
        [BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan]: {
          loading: false,
          error: null,
          snapshot: {
            generatedAt: 1,
            authenticated: true,
            context: {
              scope: "team",
              organizationId: "org-a",
              projectId: "project-a",
              productId: "product-old",
              displayName: "Snapshot Team",
            },
            provider: {
              id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
              name: "BigModel - Coding Plan",
            },
            remaining: null,
            subscription: null,
            quota: null,
          },
        },
      },
      subscribedTeamProducts: [
        {
          productId: "product-new",
          productName: "GLM Coding Team",
          productBigTitle: "GLM Coding Team",
          originalAmount: 598,
          payAmount: 598,
          priceUnit: "year",
          priceCurrency: "CNY",
          productEquityList: [],
          hasPreview: true,
          enterpriseProduct: {
            productId: "product-new",
            tier: "PRO",
            subscribeMode: "CONTINUOUS",
            subscribePeriod: "YEARLY",
            subscribed: true,
            organizationId: "org-a",
            organizationName: "Org A",
            projectId: "project-a",
            projectName: "Corrected Project",
          },
          tier: "PRO",
          subscribeMode: "CONTINUOUS",
          subscribePeriod: "YEARLY",
          purchaseMethodName: "yearly",
          subscribed: true,
          organizationId: "org-a",
          organizationName: "Org A",
          projectId: "project-a",
          projectName: "Corrected Project",
        },
      ],
      showPurchasedTeamPlanFallback: false,
    });

    const teamItems = items.filter((item) => item.type === "teamPlan");
    expect(teamItems).toHaveLength(1);
    expect(teamItems[0]?.key).toBe(`team:bigmodel:product-new:org-a:project-a`);
    expect(teamItems[0]?.teamPlanName).toBe("Org A");
  });

  it("Display Team Plan fallback using saved selected key when enterprise pricing does not return team project", () => {
    const items = buildVisibleFamilyConnectionItems({
      items: [createCodingPlanItem("purchased")],
      subscribedTeamProducts: [],
      showPurchasedTeamPlanFallback: true,
      teamPlanSelections: {
        bigmodel: {
          kind: "team-coding-plan",
          productId: "product-saved",
          organizationId: "org-saved",
          projectId: "project-saved",
        },
      },
    });

    const teamItem = items.find((item) => item.type === "teamPlan");
    expect(teamItem).toMatchObject({
      key: `team:bigmodel:product-saved:org-saved:project-saved`,
      organizationId: "org-saved",
      projectId: "project-saved",
      status: "purchased",
    });
  });
});

describe("zai family Team Plan 可见性对称化", () => {
  function createZaiCodingPlanItem(
    status: "notPurchased" | "purchased",
  ): Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }> {
    return {
      key: `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan}`,
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        name: "Z.ai - Coding Plan",
      }),
      status,
      statusActive: status === "purchased",
    };
  }

  it("Subscribed Team Plan of zai family will generate a zai-prefixed connection entry", () => {
    const items = buildVisibleFamilyConnectionItems({
      items: [createCodingPlanItem("purchased"), createZaiCodingPlanItem("purchased")],
      subscribedTeamProducts: [
        {
          productId: "zai-team-pro",
          productName: "Z.ai Coding Team",
          productBigTitle: "Z.ai Coding Team",
          originalAmount: 216,
          payAmount: 216,
          priceUnit: "year",
          priceCurrency: "USD",
          productEquityList: [],
          hasPreview: true,
          enterpriseProduct: {
            productId: "zai-team-pro",
            tier: "PRO",
            subscribeMode: "CONTINUOUS",
            subscribePeriod: "YEARLY",
            subscribed: true,
            organizationId: "zai-org",
            organizationName: "Zai Org",
            projectId: "zai-project",
            projectName: "Zai Project",
          },
          tier: "PRO",
          subscribeMode: "CONTINUOUS",
          subscribePeriod: "YEARLY",
          purchaseMethodName: "yearly",
          subscribed: true,
          organizationId: "zai-org",
          organizationName: "Zai Org",
          projectId: "zai-project",
          projectName: "Zai Project",
          family: "zai",
        },
      ],
      showPurchasedTeamPlanFallback: false,
    });

    const teamItem = items.find((item) => item.type === "teamPlan");
    expect(teamItem).toBeDefined();
    expect(teamItem?.key).toBe(`team:zai:zai-team-pro:zai-org:zai-project`);
    expect(teamItem?.providerName).toBe("Z.ai");
    expect(teamItem?.teamPlanName).toBe("Zai Org");
    expect(teamItem?.purchaseUrl).toBe(getModelProviderFamilySpec("zai").teamCodingPlanManageUrl);
  });

  it("Products without a family tag still route through bigmodel (backward compatibility)", () => {
    const items = buildVisibleFamilyConnectionItems({
      items: [createCodingPlanItem("purchased")],
      subscribedTeamProducts: [
        {
          productId: "product-team",
          productName: "GLM Coding Team",
          productBigTitle: "GLM Coding Team",
          originalAmount: 598,
          payAmount: 598,
          priceUnit: "year",
          priceCurrency: "CNY",
          productEquityList: [],
          hasPreview: true,
          enterpriseProduct: {
            productId: "product-team",
            tier: "PRO",
            subscribeMode: "CONTINUOUS",
            subscribePeriod: "YEARLY",
            subscribed: true,
            organizationId: "org-a",
            organizationName: "Org A",
            projectId: "project-a",
            projectName: "Project A",
          },
          tier: "PRO",
          subscribeMode: "CONTINUOUS",
          subscribePeriod: "YEARLY",
          purchaseMethodName: "yearly",
          subscribed: true,
          organizationId: "org-a",
          organizationName: "Org A",
          projectId: "project-a",
          projectName: "Project A",
        },
      ],
      showPurchasedTeamPlanFallback: false,
    });

    const teamItem = items.find((item) => item.type === "teamPlan");
    expect(teamItem?.key).toBe(`team:bigmodel:product-team:org-a:project-a`);
  });

  it("Teams with the same name across zai and bigmodel do not overwrite each other (deduplication by family)", () => {
    const items = buildVisibleFamilyConnectionItems({
      items: [createCodingPlanItem("purchased"), createZaiCodingPlanItem("purchased")],
      subscribedTeamProducts: [
        {
          productId: "shared-product",
          productName: "Team",
          productBigTitle: "Team",
          originalAmount: 100,
          payAmount: 100,
          priceUnit: "year",
          priceCurrency: "CNY",
          productEquityList: [],
          hasPreview: true,
          enterpriseProduct: {
            productId: "shared-product",
            tier: "PRO",
            subscribeMode: "CONTINUOUS",
            subscribePeriod: "YEARLY",
            subscribed: true,
            organizationId: "org-same",
            organizationName: "Same Org",
            projectId: "proj-same",
            projectName: "Same Project",
          },
          tier: "PRO",
          subscribeMode: "CONTINUOUS",
          subscribePeriod: "YEARLY",
          purchaseMethodName: "yearly",
          subscribed: true,
          organizationId: "org-same",
          organizationName: "Same Org",
          projectId: "proj-same",
          projectName: "Same Project",
          family: "bigmodel",
        },
        {
          productId: "shared-product",
          productName: "Team",
          productBigTitle: "Team",
          originalAmount: 100,
          payAmount: 100,
          priceUnit: "year",
          priceCurrency: "USD",
          productEquityList: [],
          hasPreview: true,
          enterpriseProduct: {
            productId: "shared-product",
            tier: "PRO",
            subscribeMode: "CONTINUOUS",
            subscribePeriod: "YEARLY",
            subscribed: true,
            organizationId: "org-same",
            organizationName: "Same Org",
            projectId: "proj-same",
            projectName: "Same Project",
          },
          tier: "PRO",
          subscribeMode: "CONTINUOUS",
          subscribePeriod: "YEARLY",
          purchaseMethodName: "yearly",
          subscribed: true,
          organizationId: "org-same",
          organizationName: "Same Org",
          projectId: "proj-same",
          projectName: "Same Project",
          family: "zai",
        },
      ],
      showPurchasedTeamPlanFallback: false,
    });

    const teamItems = items.filter((item) => item.type === "teamPlan");
    expect(teamItems).toHaveLength(2);
    const keys = teamItems.map((item) => item.key);
    expect(keys).toContain(`team:bigmodel:shared-product:org-same:proj-same`);
    expect(keys).toContain(`team:zai:shared-product:org-same:proj-same`);
  });

  it("zai-only 视图（无 bigmodel codingPlan item）仍生成 zai Team Plan 连接项", () => {
    const items = buildVisibleFamilyConnectionItems({
      items: [createZaiCodingPlanItem("notPurchased")],
      subscribedTeamProducts: [],
      showPurchasedTeamPlanFallback: true,
      teamPlanSelections: {
        zai: {
          kind: "team-coding-plan",
          productId: "zai-pro",
          organizationId: "zai-org-1",
          projectId: "zai-proj-1",
        },
      },
    });

    const teamItem = items.find((item) => item.type === "teamPlan");
    expect(teamItem).toBeDefined();
    expect(teamItem?.key).toBe(`team:zai:zai-pro:zai-org-1:zai-proj-1`);
  });
});

it("Unknown Start query status cannot display as not logged in; failed queries can be retried", () => {
  expect(
    resolveCodingPlanEntitlementState({
      providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
      accountEntitled: false,
      accountAvailability: "unknown",
      modelProvidersLoading: false,
    }).status,
  ).toBe("unavailable");
});
