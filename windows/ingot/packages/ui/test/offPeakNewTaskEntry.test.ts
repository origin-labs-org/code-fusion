// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@origin-ai/cf-shared";

const h = vi.hoisted(() => {
  const initialize = vi.fn(async () => {});
  const dismissNewTaskBanner = vi.fn();
  const setPendingCreateDraft = vi.fn();
  const refreshCodingPlanSupport = vi.fn(async () => {});
  const openCodingPlanUpgrade = vi.fn();
  const inventory = { status: "ready" as "ready" | "loading" | "error", retry: vi.fn() };
  const loggerDebug = vi.fn();
  const toast = vi.fn();
  const messages: { current: Record<string, string> } = { current: {} };
  const locale = { current: "en-US" };
  const offPeakTemplateIds = {
    current: ["standupGitSummary", "ciFlakyReport", "customize"] as string[],
  };
  const remoteTemplateCopy = {
    standupGitSummary: {
      en: {
        title: "Remote standup summary",
        description: "Remote Friday summary",
        prompt: "Summarize the remote standup.",
      },
      cn: { title: "远程站会摘要", description: "远程周五摘要", prompt: "汇总远程站会。" },
    },
    ciFlakyReport: {
      en: {
        title: "Remote CI report",
        description: "Remote CI failures",
        prompt: "Review the remote CI report.",
      },
      cn: { title: "远程 CI 报告", description: "远程 CI 失败", prompt: "检查远程 CI 报告。" },
    },
    documentationSyncCheck: {
      en: {
        title: "Remote docs check",
        description: "Remote documentation sync",
        prompt: "Review remote documentation.",
      },
      cn: { title: "Remote Doc Check", description: "Remote Doc Sync", prompt: "检查远程文档。" },
    },
  };
  const providerSettingsState = {
    view: null as import("@origin-ai/cf-services").ProviderSettingsView | null,
  };
  const state = {
    loading: false,
    grayConfig: {
      enabled: true,
      modelSelectionView: { revision: 1, providers: [] },
    },
    codingPlanSupport: {
      supported: false,
      reason: "connection_unselected",
    },
    newTaskBannerDismissed: false,
    initialize,
    refreshCodingPlanSupport,
    dismissNewTaskBanner,
    setPendingCreateDraft,
  };
  const settings = {
    providerFamilyDomain: undefined as "zai" | "bigmodel" | undefined,
    modelProviderFamilyModes: {} as Record<string, "oauth" | "apiKey">,
    modelProviderFamilySelectedKeys: {} as Record<string, string>,
  };
  const services = {
    offPeakTaskService: {},
    codingPlanSubscriptionService: {},
  };
  return {
    initialize,
    loggerDebug,
    locale,
    messages,
    offPeakTemplateIds,
    providerSettingsState,
    openCodingPlanUpgrade,
    inventory,
    refreshCodingPlanSupport,
    services,
    setPendingCreateDraft,
    settings,
    state,
    toast,
    remoteTemplateCopy,
  };
});

vi.mock("@/components/ui/toast.js", () => ({ toast: h.toast }));
vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => h.services,
}));
vi.mock("@/hooks/useProviderSettingsView.js", () => ({
  useProviderSettingsView: () => ({
    state: h.providerSettingsState.view
      ? { status: "ready", view: h.providerSettingsState.view }
      : { status: "loading" },
    reload: vi.fn(),
  }),
}));
vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({ settings: h.settings }),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    locale: h.locale.current,
    intl: {
      formatMessage: ({ id }: { id: string }) => h.messages.current[id] ?? id,
    },
  }),
}));
vi.mock("@/settings/useAutomationTemplates.js", () => ({
  useAutomationTemplates: () => ({
    scheduled: [],
    rejectedScheduledTemplateIds: [],
    offPeak: h.offPeakTemplateIds.current.map((id) => {
      const customize = id === "customize" || id === "item-customize";
      const copy = customize
        ? null
        : h.remoteTemplateCopy[
            id as "standupGitSummary" | "ciFlakyReport" | "documentationSyncCheck"
          ];
      return {
        id,
        title: copy ? { en: copy.en.title, cn: copy.cn.title } : {},
        description: copy
          ? { en: `contents:${copy.en.description}`, cn: `contents:${copy.cn.description}` }
          : {},
        homepageDescription: copy ? { en: copy.en.description, cn: copy.cn.description } : {},
        prompt: copy ? { en: copy.en.prompt, cn: copy.cn.prompt } : { en: "", cn: "" },
        customize,
        icon: customize ? "customize" : id,
        ...(customize
          ? {}
          : {
              iconName:
                id === "standupGitSummary"
                  ? "git-commit-horizontal"
                  : id === "ciFlakyReport"
                    ? "activity"
                    : "file-text",
            }),
      };
    }),
  }),
}));
vi.mock("@/logger.js", () => ({
  logger: { debug: h.loggerDebug },
}));
vi.mock("@/settings/CodingPlanUpgradeDialogProvider.js", () => ({
  useOptionalCodingPlanUpgradeDialog: () => ({
    openCodingPlanUpgrade: h.openCodingPlanUpgrade,
    inventory: h.inventory,
  }),
}));
vi.mock("@/store/offPeakTaskStore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/offPeakTaskStore.js")>();
  return {
    ...actual,
    useOffPeakTaskStore: (selector: (state: typeof h.state) => unknown) => selector(h.state),
  };
});

import { OffPeakNewTaskEntry } from "@/v4/OffPeakNewTaskEntry.js";
import enUS from "@/i18n/locales/en-US.js";
import zhCN from "@/i18n/locales/zh-CN.js";

function renderEntry(props: { onOpenAutomations?: () => void } = {}) {
  return render(createElement(OffPeakNewTaskEntry, props));
}

function clickStandupTemplate(onOpenAutomations = vi.fn()) {
  renderEntry({ onOpenAutomations });
  fireEvent.click(
    screen.getByRole("button", {
      name: /Remote standup summary Remote Friday summary/,
    }),
  );
  return onOpenAutomations;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.inventory.status = "ready";
  h.state.loading = false;
  h.state.grayConfig = {
    enabled: true,
    modelSelectionView: { revision: 1, providers: [] },
  };
  h.state.codingPlanSupport = {
    supported: false,
    reason: "connection_unselected",
  };
  h.providerSettingsState.view = {
    revision: 1,
    addableProviders: [],
    providerOrder: [],
    providers: [],
  };
  h.messages.current = {};
  h.locale.current = "en-US";
  h.offPeakTemplateIds.current = ["standupGitSummary", "ciFlakyReport", "customize"];
  h.settings.providerFamilyDomain = undefined;
  h.settings.modelProviderFamilyModes = {};
  h.settings.modelProviderFamilySelectedKeys = {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OffPeakNewTaskEntry", () => {
  it.each(["loading", "error"] as const)(
    "purchase inventory %s does not enter purchase from the blocked template",
    (status) => {
      h.inventory.status = status;
      const onOpenAutomations = clickStandupTemplate();
      const options = h.toast.mock.calls[0]?.[1];
      expect(h.setPendingCreateDraft).not.toHaveBeenCalled();
      expect(onOpenAutomations).not.toHaveBeenCalled();
      if (status === "loading") {
        expect(options?.actionLabel).toBeUndefined();
      } else {
        expect(options?.actionLabel).toBe("purchase.entry.retry");
        options?.onAction?.();
        expect(h.inventory.retry).toHaveBeenCalledOnce();
      }
      expect(h.openCodingPlanUpgrade).not.toHaveBeenCalled();
    },
  );

  it("远程目录为空时显示本地 Customize 入口", () => {
    h.offPeakTemplateIds.current = [];

    renderEntry();

    expect(screen.getByRole("button", { name: /Customize/i })).not.toBeNull();
  });

  it("Home page only displays the first two regular remote templates, with local Customize pinned at the end", () => {
    h.offPeakTemplateIds.current = [
      "standupGitSummary",
      "item-customize",
      "ciFlakyReport",
      "documentationSyncCheck",
    ];

    const view = renderEntry();
    const cards = view.container.querySelectorAll<HTMLElement>(
      "[data-off-peak-template-grid] > button",
    );

    expect(cards).toHaveLength(3);
    expect(Array.from(cards, (card) => card.textContent)).toEqual([
      "Remote standup summaryRemote Friday summary",
      "Remote CI reportRemote CI failures",
      "offPeak.newTask.template.customize.titleoffPeak.newTask.template.customize.description",
    ]);
    expect(view.container.textContent).not.toContain("Remote docs check");
  });

  it("Remote template icon and local Customize icon wiring", async () => {
    const view = renderEntry();
    const templateGrid = view.container.querySelector<HTMLElement>("[data-off-peak-template-grid]");
    const cards = templateGrid?.querySelectorAll<HTMLElement>("button") ?? [];

    expect(cards).toHaveLength(3);
    await waitFor(() => {
      expect(
        cards[0]?.querySelector('[data-client-scene-lucide-icon="git-commit-horizontal"]'),
      ).not.toBeNull();
      expect(cards[1]?.querySelector('[data-client-scene-lucide-icon="activity"]')).not.toBeNull();
    });
    expect(cards[2]?.querySelector('[data-off-peak-homepage-template-icon="moon"]')).not.toBeNull();
  });
  it("keeps the dismiss control implemented but hidden in this design round", () => {
    const view = renderEntry();
    const closeButton = view.container.querySelector<HTMLElement>(
      "[data-off-peak-new-task-dismiss]",
    );

    expect(closeButton).not.toBeNull();
    expect(closeButton?.classList.contains("hidden")).toBe(true);
  });

  it("Banner text is focusable and supports Tooltip", () => {
    renderEntry();

    const copy = screen.getByText("offPeak.newTask.bannerText");
    expect(copy.getAttribute("data-slot")).toBe("tooltip-trigger");
    expect(copy.tabIndex).toBe(0);
  });

  it("Initial mount delegates initialization and freshness registration to the shared mechanism, refreshing upon connection change", () => {
    const view = renderEntry();

    expect(h.initialize).toHaveBeenCalledOnce();
    expect(h.refreshCodingPlanSupport).toHaveBeenCalledOnce();
    view.rerender(createElement(OffPeakNewTaskEntry));
    expect(h.refreshCodingPlanSupport).toHaveBeenCalledOnce();

    h.settings.providerFamilyDomain = "zai";
    h.settings.modelProviderFamilyModes = { zai: "oauth" };
    h.settings.modelProviderFamilySelectedKeys = { zai: "zai-coding-plan" };
    view.rerender(createElement(OffPeakNewTaskEntry));

    expect(h.refreshCodingPlanSupport).toHaveBeenCalledTimes(2);
  });

  it("Non-Coding Plan users clicking templates trigger an upgrade toast directly, blocking drafts and navigation", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("idle-funnel-home");
    h.messages.current["settings.modelProvider.codingPlan.upgrade"] = "升级";
    const onOpenAutomations = clickStandupTemplate();

    expect(h.toast).toHaveBeenCalledWith("offPeak.create.codingPlanToast", {
      durationMs: 8000,
      position: "top-center",
      variant: "info",
      actionLabel: "升级",
      onAction: expect.any(Function),
      dismissible: true,
      dismissLabel: "common.close",
    });
    expect(h.setPendingCreateDraft).not.toHaveBeenCalled();
    expect(onOpenAutomations).not.toHaveBeenCalled();
    expect(h.loggerDebug).toHaveBeenCalledWith(
      "[off-peak] blocked home template without any Coding Plan",
      { templateId: "standupGitSummary" },
    );

    const toastOptions = h.toast.mock.calls[0]?.[1];
    toastOptions?.onAction?.();
    expect(h.openCodingPlanUpgrade).toHaveBeenCalledWith({
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      initialAudience: "personal",
      funnelContext: {
        purchaseFunnelId: "idle-funnel-home",
        upgradeSource: "session_idle_time",
        eventRegion: "app.session",
        eventText: "升级",
        entryPlanStatus: "no_plan",
        entryPlanLevel: "",
        entryPlanList: "",
        purchaseAudience: "personal",
        providerFamily: "zai",
        channel: "Z_AI",
      },
    });
  });

  it("Account Overlay allows off-peak task navigation once Coding Plan is confirmed available", () => {
    h.providerSettingsState.view = {
      revision: 2,
      addableProviders: [],
      providerOrder: [],
      providers: [
        {
          providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
          enabled: true,
          executable: true,
          effectiveConfig: {
            label: "BigModel Coding Plan",
            access: {
              type: "zhipu-account",
              family: "bigmodel",
              mode: "individual-coding-plan",
              entitled: true,
            },
            api: {
              type: "anthropic-messages",
              baseUrl: "https://example.com",
            },
            builtinModelIds: ["glm-5"],
            enabled: true,
          },
          issues: [],
          models: [],
        },
      ],
    };
    const onOpenAutomations = clickStandupTemplate();

    expect(h.toast).not.toHaveBeenCalled();
    expect(h.setPendingCreateDraft).toHaveBeenCalledOnce();
    expect(onOpenAutomations).toHaveBeenCalledOnce();
  });

  it("Do not mistake unknown state for no plan when Provider Settings has not yet hydrated", () => {
    h.providerSettingsState.view = null;
    const onOpenAutomations = clickStandupTemplate();

    expect(h.toast).not.toHaveBeenCalled();
    expect(h.setPendingCreateDraft).toHaveBeenCalledOnce();
    expect(onOpenAutomations).toHaveBeenCalledOnce();
  });

  it("uses the visible English Upgrade copy as the idle-time event text", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("idle-funnel-en");
    h.messages.current["settings.modelProvider.codingPlan.upgrade"] = "Upgrade";
    clickStandupTemplate();

    const toastOptions = h.toast.mock.calls[0]?.[1];
    toastOptions?.onAction?.();

    expect(h.openCodingPlanUpgrade.mock.calls[0]?.[0]?.funnelContext?.eventText).toBe("Upgrade");
  });

  it.each([
    {
      locale: "zh-CN",
      messages: zhCN,
      bannerText: "New feature trial for subscribers: Create \"Off-Peak Tasks\", and we will complete your assigned tasks for free during surplus compute periods.",
      bannerTipText: "This feature does not consume subscriber plan quota; this feature is only available to subscribers",
    },
    {
      locale: "en-US",
      messages: enUS,
      bannerText:
        'New feature for subscribers: Create "Idle-time task" , We will complete your assigned task for free during periods of surplus computing power.',
      bannerTipText:
        "This feature does not consume your subscription plan quota and is available exclusively to subscribers.",
    },
  ])(
    "$locale home page display, prompts, and template pre-fills use the same language",
    ({ locale, messages, bannerText, bannerTipText }) => {
      h.messages.current = messages;
      h.locale.current = locale;
      h.providerSettingsState.view = {
        revision: 2,
        addableProviders: [],
        providerOrder: [],
        providers: [
          {
            providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
            enabled: true,
            executable: true,
            effectiveConfig: {
              label: "Z.ai Coding Plan",
              access: {
                type: "zhipu-account",
                family: "zai",
                mode: "individual-coding-plan",
                entitled: true,
              },
              api: {
                type: "anthropic-messages",
                baseUrl: "https://example.com",
              },
              builtinModelIds: ["glm-5"],
            },
            issues: [],
            models: [],
          },
        ],
      };

      const copy = h.remoteTemplateCopy.standupGitSummary[locale === "zh-CN" ? "cn" : "en"];
      const { title, description, prompt } = copy;
      const onOpenAutomations = vi.fn();

      render(createElement(OffPeakNewTaskEntry, { onOpenAutomations }));
      const bannerCopy = screen.getByText(bannerText);
      fireEvent.focus(bannerCopy);
      const tipCopies = screen.getAllByText(bannerTipText);
      expect(tipCopies.length).toBeGreaterThan(0);
      const templateCard = screen.getByRole("button", {
        name: `${title} ${description}`,
      });
      fireEvent.click(templateCard);

      expect(h.toast).not.toHaveBeenCalled();
      expect(h.setPendingCreateDraft).toHaveBeenCalledWith({
        title,
        prompt,
        telemetrySource: {
          eventRegion: "app.session",
          templateId: "standupGitSummary",
        },
      });
      expect(onOpenAutomations).toHaveBeenCalledOnce();
    },
  );
});
