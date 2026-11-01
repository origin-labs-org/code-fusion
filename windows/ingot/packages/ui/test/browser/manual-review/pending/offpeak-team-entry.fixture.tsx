import { useState } from "react";
import type { IServiceAccessor, ProviderSettingsView } from "@origin-ai/cf-services";
import type { IPlatformService } from "@origin-ai/cf-shared";
import { ServiceProvider } from "@/hooks/useServices.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { connectProviderSettingsSnapshot } from "@/lib/providerSettingsSnapshot.js";
import { OffPeakNewTaskEntry } from "@/v4/OffPeakNewTaskEntry.js";
import { useOffPeakTaskStore } from "@/store/offPeakTaskStore.js";

const query = new URLSearchParams(location.search);
const family = query.get("family") ?? "bigmodel";
const providerId = `account:${family}-team-coding-plan`;
const view = {
  revision: 1,
  providerTemplates: [],
  providers: [
    {
      providerId,
      enabled: true,
      executable: true,
      models: [],
      issues: [],
      effectiveConfig: {
        access: {
          type: "zhipu-account",
          accountType: family,
          mode: "team-coding-plan",
          entitled: !query.has("noPlan"),
        },
      },
    },
  ],
} as unknown as ProviderSettingsView;
const services = {
  providerSettingsService: {
    async getView() {
      return view;
    },
    onDidChange() {
      return { dispose() {} };
    },
  },
  settingService: {
    async get() {
      return { providerFamilyDomain: family };
    },
  },
  clientScenesService: {
    async list() {
      return { code: 0, data: [] };
    },
  },
  codingPlanSubscriptionService: {
    async getOffPeakClientConfig() {
      return {
        enabled: !query.has("grayOff"),
        ...(query.has("inactive") ? { codingPlanActive: false } : {}),
      };
    },
  },
  offPeakTaskService: {
    async list() {
      return [];
    },
    async getCodingPlanSupport() {
      return { supported: true, providerId };
    },
    async getTakeNumberAvailability() {
      return { canTakeNumber: true };
    },
  },
} as unknown as IServiceAccessor;
if (new URLSearchParams(location.search).has("teamEntry")) {
  void connectProviderSettingsSnapshot(services.providerSettingsService).ready;
}

export function OffPeakTeamEntryFixture() {
  const [opened, setOpened] = useState(0);
  const state = useOffPeakTaskStore();
  return (
    <ServiceProvider services={services}>
      <PlatformProvider platform={{} as IPlatformService}>
        <button data-testid="dismiss-entry" onClick={() => state.dismissNewTaskBanner()}>
          Close入口
        </button>
        <OffPeakNewTaskEntry onOpenAutomations={() => setOpened((n) => n + 1)} />
        <output data-testid="team-opened">{opened}</output>
        <output data-testid="team-loaded">
          {String(state.grayConfig !== null && !state.loading)}
        </output>
        <output data-testid="team-draft">{JSON.stringify(state.pendingCreateDraft)}</output>
      </PlatformProvider>
    </ServiceProvider>
  );
}
