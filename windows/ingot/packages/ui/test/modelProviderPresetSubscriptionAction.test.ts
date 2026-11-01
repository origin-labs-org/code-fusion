// @vitest-environment jsdom
import { createElement } from "react";
import { render, cleanup, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { BIGMODEL_PROVIDER_ID, BUILTIN_MODEL_PROVIDER_IDS, ZAI_PROVIDER_ID } from "@origin-ai/cf-shared";
import type {
  ProviderFamilyConnectionSelectionSettings,
  ProviderFamilyDomain,
} from "@origin-ai/cf-shared";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";

const TEST_BIGMODEL_PROVIDER_ID = "test-bigmodel-api-provider";

const refreshMock = vi.fn(async () => {});
const getActiveProviderMock = vi.fn(async () => null as string | null);
const requestLoginEntryMock = vi.fn();
const startOAuthMock = vi.fn(async () => ({
  authorizeUrl: "https://example.com/oauth/authorize?state=demo",
  provider: "bigmodel" as const,
  state: "demo-state",
}));
const openExternalMock = vi.fn();
const registerOAuthStateMock = vi.fn();
const logoutMock = vi.fn(async () => {});
const refreshCodingPlanEntitlementsMock = vi.fn(async () => {});
const credentialLoadMock = vi.fn(async () => null as string | null);
const updateSharedSettingsMock = vi.fn(async () => {});
const setUserMock = vi.fn();
const setOAuthErrorMock = vi.fn();
const saveProviderMock = vi.fn(async (_config: ProviderSettingsFormProvider) => []);
const emptyProducts: never[] = [];
const refreshProductsMock = vi.fn(async () => {});
const emptyProductSnapshot = { productList: emptyProducts, authenticated: true };
vi.mock("@/settings/model-provider-section/useEnterpriseCodingPlanProducts.js", () => ({
  useEnterpriseCodingPlanProducts: () => ({
    snapshot: emptyProductSnapshot,
    products: emptyProducts,
    subscribedProducts: emptyProducts,
    refresh: refreshProductsMock,
    loading: false,
  }),
}));
let settingsMock: {
  providerFamilyDomain?: ProviderFamilyDomain;
  providerFamilyConnectionSelections?: ProviderFamilyConnectionSelectionSettings;
} = {};

vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({
    settings: settingsMock,
    loading: false,
    error: null,
    update: updateSharedSettingsMock,
  }),
}));

let capturedDetailProps: Record<string, unknown> | null = null;
let selectedNavItemMock: unknown = null;

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
  }),
}));

vi.mock("@/hooks/useConfirmDialog.js", () => ({
  useConfirmDialog: () => vi.fn(async () => true),
}));

vi.mock("@/hooks/useModelProviders.js", () => ({
  useModelProviders: () => ({
    modelProviders: [
      {
        id: TEST_BIGMODEL_PROVIDER_ID,
        name: "BigModel",
        endpoints: {
          anthropic: "https://open.bigmodel.cn/api/anthropic",
          openai: "https://open.bigmodel.cn/api/openai/chat",
          gemini: "",
        },
        apiKey: "",
        models: ["glm-4.7"],
        providerMappings: {
          claude: {
            haiku: "glm-4.7",
            sonnet: "glm-4.7",
            opus: "glm-4.7",
            reasoning: "glm-4.7",
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    loading: false,
    refreshing: false,
    refresh: refreshMock,
    saveProvider: saveProviderMock,
    deleteProvider: vi.fn(async () => {}),
    testModelConnectivity: vi.fn(async () => ({ success: true as const })),
  }),
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({
    openExternal: openExternalMock,
    registerOAuthState: registerOAuthStateMock,
  }),
}));

vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => ({
    modelSelectionService: {
      getView: vi.fn(async () => ({ revision: 1, providers: [] })),
    },
    oauthService: {
      getActiveProvider: getActiveProviderMock,
      startOAuth: startOAuthMock,
      logout: logoutMock,
    },
    credentialService: {
      load: credentialLoadMock,
    },
    settingService: {
      get: vi.fn(async () => ({})),
      update: updateSharedSettingsMock,
    },
  }),
  useOptionalServices: () => {
    return null;
  },
}));

vi.mock("@/store/TabStoreProvider.js", () => ({
  useTabStore: (selector: (state: { activeWorkspacePath: null; tabs: [] }) => unknown) =>
    selector({
      activeWorkspacePath: null,
      tabs: [],
    }),
}));

vi.mock("@/store/StoreProvider.js", () => ({
  useCfStore: (
    selector: (state: {
      user: null;
      requestLoginEntry: typeof requestLoginEntryMock;
      setUser: typeof setUserMock;
      setOAuthError: typeof setOAuthErrorMock;
    }) => unknown,
  ) =>
    selector({
      user: null,
      requestLoginEntry: requestLoginEntryMock,
      setUser: setUserMock,
      setOAuthError: setOAuthErrorMock,
    }),
}));

vi.mock("../src/settings/model-provider-section/useModelProviderNavigation.js", () => ({
  useModelProviderNavigation: () => ({
    navigationGroups: [],
    navigationItems: [],
    selectedNavItem: selectedNavItemMock,
  }),
}));

vi.mock("../src/settings/model-provider-section/useCodingPlanEntitlements.js", () => ({
  useCodingPlanAccessRefresh: () => undefined,
  useCodingPlanEntitlements: () => ({
    entitlements: {},
    refresh: refreshCodingPlanEntitlementsMock,
  }),
}));

vi.mock("../src/settings/model-provider-section/SectionLayout.js", () => ({
  ModelProviderSectionLayout: ({ children }: { children: unknown }) =>
    createElement("div", null, children),
}));

vi.mock("../src/settings/model-provider-section/Detail.js", () => ({
  ModelProviderSectionDetail: (props: Record<string, unknown>) => {
    capturedDetailProps = props;
    return createElement("div");
  },
}));

describe("ModelProviderSection preset subscription action", () => {
  afterEach(cleanup);
  it("Opening page and refreshing subscription do not automatically change team to personal", async () => {
    settingsMock = {
      providerFamilyDomain: "bigmodel",
      providerFamilyConnectionSelections: {
        bigmodel: { kind: "team-coding-plan", productId: "p", organizationId: "o", projectId: "j" },
      },
    };
    const { ModelProviderSection } = await import("@/settings/ModelProviderSection.js");
    const mounted = render(createElement(ModelProviderSection));
    await waitFor(() => expect(credentialLoadMock).toHaveBeenCalled());
    mounted.rerender(createElement(ModelProviderSection));
    expect(updateSharedSettingsMock).not.toHaveBeenCalled();
  });
  it.each(["bigmodel", "zai"] as const)("Saving %s non-executable provider does not change account domain", async (family) => {
    settingsMock = { providerFamilyDomain: family };
    const { ModelProviderSection } = await import("@/settings/ModelProviderSection.js");
    renderToStaticMarkup(createElement(ModelProviderSection));
    const config = {
      providerId:
        family === "bigmodel"
          ? BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan
          : BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      enabled: false,
      executable: false,
      config: {},
      personalConfig: {},
      models: [],
    } as unknown as ProviderSettingsFormProvider;
    await (
      capturedDetailProps!.onSave as (provider: ProviderSettingsFormProvider) => Promise<void>
    )(config);
    expect(saveProviderMock).toHaveBeenCalledWith(config);
    expect(updateSharedSettingsMock).not.toHaveBeenCalled();
  });

  it.each(["bigmodel", "zai"] as const)(
    "Explicitly selecting %s from same team restores domain while preserving identity in the other domain",
    async (family) => {
      const selection = {
        kind: "team-coding-plan" as const,
        productId: "p",
        organizationId: "o",
        projectId: "j",
      };
      const selections = { bigmodel: selection, zai: selection };
      const item = {
        key: "team",
        type: "teamPlan",
        presetId:
          family === "bigmodel"
            ? BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan
            : BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan,
        oauthProviderId: family,
        currentProductId: "p",
        organizationId: "o",
        projectId: "j",
      };
      settingsMock = { providerFamilyConnectionSelections: selections };
      const { ModelProviderSection } = await import("@/settings/ModelProviderSection.js");
      renderToStaticMarkup(createElement(ModelProviderSection));
      expect(updateSharedSettingsMock).not.toHaveBeenCalled();
      (capturedDetailProps!.onSelectNavItem as (item: unknown) => void)(item);
      await vi.waitFor(() => expect(updateSharedSettingsMock).toHaveBeenCalledTimes(1));
      expect(updateSharedSettingsMock).toHaveBeenCalledWith(
        {
          providerFamilyDomain: family,
          providerFamilyDomainUpdatedAt: expect.any(Number),
          providerFamilyDomainMigrated: true,
          providerFamilyConnectionSelections: selections,
        },
        {
          providerFamilyDomain: undefined,
          providerFamilyConnectionSelections: selections,
          providerFamilyDomainUpdatedAt: 0,
        },
      );
      updateSharedSettingsMock.mockClear();
      settingsMock = { ...settingsMock, providerFamilyDomain: family };
      renderToStaticMarkup(createElement(ModelProviderSection));
      (capturedDetailProps!.onSelectNavItem as (item: unknown) => void)(item);
      expect(updateSharedSettingsMock).not.toHaveBeenCalled();
      (capturedDetailProps!.onSelectNavItem as (item: unknown) => void)({
        ...item,
        projectId: "other-project",
      });
      await vi.waitFor(() => expect(updateSharedSettingsMock).toHaveBeenCalledTimes(1));
      expect(updateSharedSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          providerFamilyDomain: family,
          providerFamilyConnectionSelections: {
            ...selections,
            [family]: { ...selection, projectId: "other-project" },
          },
        }),
        {
          providerFamilyDomain: family,
          providerFamilyConnectionSelections: selections,
          providerFamilyDomainUpdatedAt: 0,
        },
      );
    },
  );
  beforeEach(() => {
    capturedDetailProps = null;
    settingsMock = {};
    saveProviderMock.mockClear();
    selectedNavItemMock = null;
    refreshMock.mockClear();
    getActiveProviderMock.mockClear();
    getActiveProviderMock.mockResolvedValue(null);
    requestLoginEntryMock.mockClear();
    startOAuthMock.mockClear();
    openExternalMock.mockClear();
    registerOAuthStateMock.mockClear();
    logoutMock.mockClear();
    refreshCodingPlanEntitlementsMock.mockClear();
    credentialLoadMock.mockClear();
    credentialLoadMock.mockResolvedValue(null);
    updateSharedSettingsMock.mockClear();
    setUserMock.mockClear();
    setOAuthErrorMock.mockClear();
  });

  it("Z.ai Coding Plan Connect opens app login entry point", async () => {
    const { ModelProviderSection } = await import("@/settings/ModelProviderSection.js");

    renderToStaticMarkup(createElement(ModelProviderSection));

    expect(capturedDetailProps).not.toBeNull();

    await (
      capturedDetailProps?.onCodingPlanLogin as
        | ((presetId: string, providerId: string, providerName: string) => Promise<void>)
        | undefined
    )?.(BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan, ZAI_PROVIDER_ID, "Z.ai");

    expect(refreshMock).not.toHaveBeenCalled();
    expect(requestLoginEntryMock).toHaveBeenCalledWith(ZAI_PROVIDER_ID);
    expect(startOAuthMock).not.toHaveBeenCalled();
  });

  it("Clicking login on Z.ai Coding Plan sync failure reopens login entry point", async () => {
    const { ModelProviderSection } = await import("@/settings/ModelProviderSection.js");

    renderToStaticMarkup(createElement(ModelProviderSection));

    expect(capturedDetailProps).not.toBeNull();

    await (
      capturedDetailProps?.onCodingPlanLogin as
        | ((
            presetId: string,
            providerId: string,
            providerName: string,
            status: string,
          ) => Promise<void>)
        | undefined
    )?.(BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan, ZAI_PROVIDER_ID, "Z.ai", "unavailable");

    expect(requestLoginEntryMock).toHaveBeenCalledWith(ZAI_PROVIDER_ID);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("Z.ai Coding Plan token recovery forces in-app login entry point", async () => {
    const { ModelProviderSection } = await import("@/settings/ModelProviderSection.js");

    renderToStaticMarkup(createElement(ModelProviderSection));

    expect(capturedDetailProps).not.toBeNull();

    await (
      capturedDetailProps?.onCodingPlanLogin as
        | ((
            presetId: string,
            providerId: string,
            providerName: string,
            status: string,
            options?: { forceOAuth?: boolean },
          ) => Promise<void>)
        | undefined
    )?.(
      BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      ZAI_PROVIDER_ID,
      "Z.ai",
      "notPurchased",
      { forceOAuth: true },
    );

    expect(requestLoginEntryMock).toHaveBeenCalledWith(ZAI_PROVIDER_ID);
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("Refresh Account Source and settings page after successful Coding Plan purchase", async () => {
    selectedNavItemMock = {
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: null,
      status: "notPurchased",
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    };
    const { ModelProviderSection } = await import("@/settings/ModelProviderSection.js");

    renderToStaticMarkup(createElement(ModelProviderSection));

    expect(capturedDetailProps).not.toBeNull();

    (capturedDetailProps?.onCodingPlanPurchaseComplete as (() => void) | undefined)?.();

    await vi.waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(credentialLoadMock).toHaveBeenCalledWith("oauth:active_provider");
  });

  it("Delegate BigModel Coding Plan unbinding to OAuth logout to clean up derived state", async () => {
    const { ModelProviderSection } = await import("@/settings/ModelProviderSection.js");

    renderToStaticMarkup(createElement(ModelProviderSection));

    expect(capturedDetailProps).not.toBeNull();

    await (
      capturedDetailProps?.onCodingPlanDisconnect as
        | ((presetId: string, providerId: string, providerName: string) => Promise<void>)
        | undefined
    )?.(BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan, BIGMODEL_PROVIDER_ID, "BigModel");

    expect(logoutMock).toHaveBeenCalledWith(BIGMODEL_PROVIDER_ID);
    expect(setUserMock).toHaveBeenCalledWith(null);
    expect(refreshMock).toHaveBeenCalled();
    expect(refreshCodingPlanEntitlementsMock).not.toHaveBeenCalled();
  });

  it("Delegate Z.ai provider unbinding to OAuth logout to clean up Coding Plan and Start Plan", async () => {
    const { ModelProviderSection } = await import("@/settings/ModelProviderSection.js");

    renderToStaticMarkup(createElement(ModelProviderSection));

    expect(capturedDetailProps).not.toBeNull();

    await (
      capturedDetailProps?.onCodingPlanDisconnect as
        | ((presetId: string, providerId: string, providerName: string) => Promise<void>)
        | undefined
    )?.(BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan, ZAI_PROVIDER_ID, "Z.ai");

    expect(logoutMock).toHaveBeenCalledWith(ZAI_PROVIDER_ID);
    expect(setUserMock).toHaveBeenCalledWith(null);
    expect(refreshMock).toHaveBeenCalled();
    expect(refreshCodingPlanEntitlementsMock).not.toHaveBeenCalled();
  });
});
