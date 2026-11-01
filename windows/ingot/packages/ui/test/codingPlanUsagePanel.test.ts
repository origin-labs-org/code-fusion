import { describe, expect, it } from "vitest";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@origin-ai/cf-shared";
import { buildCodingPlanUsageDetailLineChartSeries } from "@/settings/usage-stats/codingPlanUsageChartSeries.js";
import { calculateCodingPlanBarChartMaxValue } from "@/settings/usage-stats/CodingPlanUsageBarChart.js";
import {
  buildCodingPlanUsageSources,
  formatUsageStatsQuotaResetTime,
  hasCodingPlanCreditUsageData,
  resolveCodingPlanUsageProviderName,
  shouldShowCodingPlanUsageDetailSummary,
} from "@/settings/usage-stats/CodingPlanUsagePanel.js";
import {
  findCodingPlanQuotaLimit,
  formatQuotaRemainingPercentage,
  formatQuotaResetTime,
  getQuotaRemainingPercentage,
} from "@/lib/codingPlanQuotaPresentation.js";
import {
  buildPersonalCodingPlanUsageSource,
  resolveSidebarCurrentCodingPlanUsageSource,
} from "@/lib/codingPlanUsageSources.js";
import { formatSummaryCompactTokenUsage } from "@/settings/usage-stats/usageStatsUiParts.js";

describe("CodingPlanUsagePanel", () => {
  it("Preserve space between numbers and units in Chinese Token summaries for individual and team plans", () => {
    expect(formatSummaryCompactTokenUsage("zh-CN", 370_000_000)).toBe("3.7 亿");
    expect(formatSummaryCompactTokenUsage("en-US", 370_000_000)).toBe("370M");
  });

  it("Use Account Access for individual plan source instead of request credentials", () => {
    expect(
      buildPersonalCodingPlanUsageSource({
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        accountAccess: {
          type: "zhipu-account",
          family: "zai",
          planKind: "individual-coding-plan",
        },
        label: "Z.ai - Coding Plan",
      }),
    ).toEqual({
      id: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      accountAccess: {
        type: "zhipu-account",
        family: "zai",
        planKind: "individual-coding-plan",
      },
      label: "Z.ai - Coding Plan",
    });
  });

  it("把已购 Team Plan 展开为可查询的 usage source", () => {
    const sources = buildCodingPlanUsageSources({
      accountAccesses: {
        bigmodel: {
          type: "zhipu-account",
          family: "bigmodel",
          mode: "team-coding-plan",
        },
      },
      subscribedTeamProducts: [
        {
          productId: "product-team",
          productName: "Pro",
          projectName: "Team A",
          subscribed: true,
          teamProjects: [
            {
              organizationId: "org-team",
              organizationName: "Org",
              projectId: "proj-team",
              projectName: "Team A",
            },
          ],
        } as never,
      ],
    });

    expect(sources).toEqual([
      {
        id: "team:bigmodel:product-team:org-team:proj-team",
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
        accountAccess: {
          type: "zhipu-account",
          family: "bigmodel",
          planKind: "team-coding-plan",
          productId: "product-team",
          organizationId: "org-team",
          projectId: "proj-team",
        },
        label: "BigModel - Org",
      },
    ]);
  });

  it("Expand zai purchased Team Plan into usage source with zai providerId and Z.ai brand prefix", () => {
    const sources = buildCodingPlanUsageSources({
      accountAccesses: {
        zai: {
          type: "zhipu-account",
          family: "zai",
          mode: "team-coding-plan",
        },
      },
      subscribedTeamProducts: [
        {
          productId: "zai-product-team",
          productName: "Pro",
          projectName: "ZAI Team A",
          subscribed: true,
          family: "zai",
          teamProjects: [
            {
              organizationId: "zai-org",
              organizationName: "ZAI Org",
              projectId: "zai-proj",
              projectName: "ZAI Team A",
            },
          ],
        } as never,
      ],
    });

    expect(sources).toEqual([
      {
        id: "team:zai:zai-product-team:zai-org:zai-proj",
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan,
        accountAccess: {
          type: "zhipu-account",
          family: "zai",
          planKind: "team-coding-plan",
          productId: "zai-product-team",
          organizationId: "zai-org",
          projectId: "zai-proj",
        },
        label: "Z.ai - ZAI Org",
      },
    ]);
  });

  it("resolveSidebarCurrentCodingPlanUsageSource resolves zai team selectedKey into team source", () => {
    const teamSources = buildCodingPlanUsageSources({
      accountAccesses: {
        zai: {
          type: "zhipu-account",
          family: "zai",
          mode: "team-coding-plan",
        },
      },
      subscribedTeamProducts: [
        {
          productId: "zai-product-team",
          productName: "Pro",
          projectName: "ZAI Team A",
          subscribed: true,
          family: "zai",
          teamProjects: [
            {
              organizationId: "zai-org",
              organizationName: "ZAI Org",
              projectId: "zai-proj",
              projectName: "ZAI Team A",
            },
          ],
        } as never,
      ],
    });

    const resolved = resolveSidebarCurrentCodingPlanUsageSource({
      selections: {
        zai: {
          kind: "team-coding-plan",
          productId: "zai-product-team",
          organizationId: "zai-org",
          projectId: "zai-proj",
        },
      },
      selectedProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan,
      accountAccesses: {},
      teamSources,
    });

    expect(resolved).toEqual({
      audience: "team",
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan,
      sourceId: "team:zai:zai-product-team:zai-org:zai-proj",
      teamSource: teamSources[0],
    });
  });

  it("resolveSidebarCurrentCodingPlanUsageSource returns null when zai team key matches no source (does not fall back to individual)", () => {
    const resolved = resolveSidebarCurrentCodingPlanUsageSource({
      selections: {
        zai: {
          kind: "team-coding-plan",
          productId: "unknown",
          organizationId: "unknown",
          projectId: "unknown",
        },
      },
      selectedProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan,
      accountAccesses: {},
      teamSources: [],
    });

    expect(resolved).toBeNull();
  });

  it("resolveSidebarCurrentCodingPlanUsageSource resolves zai individual coding-plan key into individual", () => {
    const resolved = resolveSidebarCurrentCodingPlanUsageSource({
      selections: { zai: { kind: "individual-coding-plan" } },
      selectedProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      accountAccesses: {
        zai: {
          type: "zhipu-account",
          family: "zai",
          mode: "individual-coding-plan",
        },
      },
      teamSources: [],
    });

    expect(resolved).toEqual({
      audience: "individual",
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      sourceId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      accountAccess: {
        type: "zhipu-account",
        family: "zai",
        mode: "individual-coding-plan",
      },
    });
  });

  it("Do not generate empty Team Plan usage source when organization name is missing", () => {
    const sources = buildCodingPlanUsageSources({
      accountAccesses: {
        bigmodel: {
          type: "zhipu-account",
          family: "bigmodel",
          planKind: "team-coding-plan",
          productId: "product-team",
          organizationId: "org-team",
          projectId: "proj-team",
        },
      },
      subscribedTeamProducts: [
        {
          productId: "product-team",
          productName: "Pro",
          projectName: "Team A",
          subscribed: true,
          teamProjects: [
            {
              organizationId: "org-team",
              organizationName: null,
              projectId: "proj-team",
              projectName: "Team A",
            },
          ],
        } as never,
      ],
    });

    expect(sources).toEqual([]);
  });

  it("Team Plan remaining quota title prioritizes showing team project name", () => {
    expect(
      resolveCodingPlanUsageProviderName({
        fallbackProviderName: "BigModel - Coding Plan",
        source: {
          id: "team:bigmodel:product-team:org-team:proj-team",
          providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
          label: "BigModel - Team A",
          accountAccess: {
            type: "zhipu-account",
            family: "bigmodel",
            planKind: "team-coding-plan",
            productId: "product-team",
            organizationId: "org-team",
            projectId: "proj-team",
          },
        },
        snapshot: {
          sourceProvider: {
            id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
            name: "BigModel - Coding Plan",
          },
        } as never,
      }),
    ).toBe("BigModel - Team A");
  });

  it("Individual plan remaining quota title does not show BigModel built-in connection name", () => {
    expect(
      resolveCodingPlanUsageProviderName({
        fallbackProviderName: "BigModel - Coding Plan",
        source: {
          id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
          providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
          label: "BigModel - Coding Plan",
        },
        snapshot: {
          sourceProvider: {
            id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
            name: "BigModel - Coding Plan",
          },
        } as never,
      }),
    ).toBeUndefined();
  });

  it("Generate bar chart series by actual model for usage detail model dimension", () => {
    expect(
      buildCodingPlanUsageDetailLineChartSeries({
        metric: "credits",
        subject: "model",
        modelDataList: [
          {
            modelName: "glm-5",
            sortOrder: 1,
            tokensUsage: [10, 20],
            creditsUsage: [1, 2],
            cachedInputCreditsUsage: [0.4, 0.8],
            uncachedInputCreditsUsage: [0.5, 1],
            outputCreditsUsage: [0.1, 0.2],
            totalTokens: 30,
            totalCredits: 3,
          },
        ],
        toolDataList: [],
      }),
    ).toEqual([
      {
        breakdown: {
          cachedInput: [0.4, 0.8],
          output: [0.1, 0.2],
          uncachedInput: [0.5, 1],
        },
        name: "glm-5",
        values: [1, 2],
      },
    ]);
  });

  it("Calculate Y-axis maximum for Coding Plan bar chart based on individual grouped bar height", () => {
    expect(
      calculateCodingPlanBarChartMaxValue(
        [
          {
            name: "GLM-5.3",
            values: [100],
            breakdown: {
              cachedInput: [70],
              uncachedInput: [20],
              output: [10],
            },
          },
          {
            name: "GLM-5-Turbo",
            values: [90],
            breakdown: {
              cachedInput: [60],
              uncachedInput: [20],
              output: [10],
            },
          },
        ],
        1,
      ),
    ).toBe(100);
  });

  it("旧版 Coding Plan 只有 token 用量时不展示积分摘要卡", () => {
    const legacyUsage = {
      summary: {
        cacheHitRate: 0.894,
        cacheHitRateTrend: -0.06,
        totalCredits: 0,
        totalCreditsTrend: 0,
        averageDailyCredits: 0,
        averageDailyCreditsTrend: 0,
      },
      modelDataList: [
        {
          modelName: "GLM-5.2",
          sortOrder: 1,
          tokensUsage: [12_950_000],
          totalTokens: 12_950_000,
        },
      ],
      toolDataList: [],
    };

    expect(hasCodingPlanCreditUsageData(legacyUsage)).toBe(false);
    expect(shouldShowCodingPlanUsageDetailSummary(legacyUsage)).toBe(false);
  });

  it("新版 Coding Plan 有 credits 数据时展示积分摘要卡", () => {
    const creditUsage = {
      summary: {
        cacheHitRate: 0.89,
        cacheHitRateTrend: null,
        totalCredits: 28.95,
        totalCreditsTrend: null,
        averageDailyCredits: 28.95,
        averageDailyCreditsTrend: null,
      },
      modelDataList: [
        {
          modelName: "GLM-5.3",
          sortOrder: 1,
          tokensUsage: [120],
          creditsUsage: [28.95],
          totalTokens: 120,
          totalCredits: 28.95,
        },
      ],
      toolDataList: [],
    };

    expect(hasCodingPlanCreditUsageData(creditUsage)).toBe(true);
    expect(shouldShowCodingPlanUsageDetailSummary(creditUsage)).toBe(true);
  });

  it("quota card displays remaining quota percentage instead of used percentage", () => {
    const limit = {
      type: "TOKENS_LIMIT",
      unit: 3,
      number: 5,
      percentage: 25,
      usageDetails: [],
    };

    expect(getQuotaRemainingPercentage(limit)).toBe(75);
    expect(formatQuotaRemainingPercentage("en-US", limit)).toBe("75%");
  });

  it("Usage page and Usage Remaining menu reuse the same reset time format", () => {
    const resetAt = new Date(2026, 6, 10, 8, 30).getTime();

    expect(
      formatQuotaResetTime({
        locale: "en-US",
        value: resetAt,
        format: "dateTime",
      }),
    ).toBe("Jul 10, 08:30");
    expect(
      formatQuotaResetTime({
        locale: "en-US",
        value: resetAt,
        format: "date",
      }),
    ).toBe("Jul 10");
  });

  it("Only Usage stats quota cards consistently display month/day and hour/minute", () => {
    const resetAt = new Date(2026, 8, 16, 23, 0).getTime();

    expect(formatUsageStatsQuotaResetTime("zh-CN", resetAt)).toBe("9月16日 23:00");
    expect(formatUsageStatsQuotaResetTime("zh-CN", undefined)).toBeUndefined();
  });

  it("findCodingPlanQuotaLimit equivalently matches CREDIT_LIMIT when querying by TOKENS_LIMIT", () => {
    const zaiTeamLimits = [
      {
        type: "CREDIT_LIMIT",
        unit: 3,
        number: 5,
        percentage: 27,
        usageDetails: [],
      },
      {
        type: "CREDIT_LIMIT",
        unit: 6,
        number: 1,
        percentage: 10,
        usageDetails: [],
      },
    ];

    expect(findCodingPlanQuotaLimit(zaiTeamLimits, "TOKENS_LIMIT", 3, 5)).toEqual(zaiTeamLimits[0]);
    expect(findCodingPlanQuotaLimit(zaiTeamLimits, "TOKENS_LIMIT", 6)).toEqual(zaiTeamLimits[1]);
    expect(findCodingPlanQuotaLimit(zaiTeamLimits, "TIME_LIMIT", 5, 1)).toBeNull();
  });

  it("findCodingPlanQuotaLimit retains original behavior for bigmodel TOKENS_LIMIT", () => {
    const bigmodelLimits = [
      {
        type: "TOKENS_LIMIT",
        unit: 3,
        number: 5,
        percentage: 40,
        usageDetails: [],
      },
      {
        type: "TIME_LIMIT",
        unit: 5,
        number: 1,
        percentage: 15,
        usageDetails: [],
      },
    ];

    expect(findCodingPlanQuotaLimit(bigmodelLimits, "TOKENS_LIMIT", 3, 5)).toEqual(
      bigmodelLimits[0],
    );
    expect(findCodingPlanQuotaLimit(bigmodelLimits, "TIME_LIMIT", 5, 1)).toEqual(bigmodelLimits[1]);
    expect(findCodingPlanQuotaLimit(bigmodelLimits, "CREDIT_LIMIT", 5, 1)).toBeNull();
  });
});
