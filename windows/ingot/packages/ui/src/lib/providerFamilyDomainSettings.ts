import type { ISettingService } from "@origin-ai/cf-services";
import {
  type AppSettings,
  type ProviderFamilyConnectionSelectionSettings,
  type ProviderFamilyDomain,
} from "@origin-ai/cf-shared";

export function resolveLogoutProviderFamilyDomain(params: {
  currentDomain: ProviderFamilyDomain | null | undefined;
}): ProviderFamilyDomain | null {
  void params;
  return null;
}

export async function setProviderFamilyDomain(
  settingService: Pick<ISettingService, "get" | "update">,
  domain: ProviderFamilyDomain,
): Promise<void> {
  const currentSettings = await settingService.get();
  await settingService.update(
    {
      providerFamilyDomain: domain,
      providerFamilyDomainUpdatedAt: Date.now(),
      providerFamilyDomainMigrated: true,
      providerFamilyConnectionSelections: buildOAuthProviderFamilySelections(
        domain,
        currentSettings.providerFamilyConnectionSelections,
      ),
    },
    {
      providerFamilyDomain: currentSettings.providerFamilyDomain,
      providerFamilyConnectionSelections: currentSettings.providerFamilyConnectionSelections,
      providerFamilyDomainUpdatedAt: currentSettings.providerFamilyDomainUpdatedAt ?? 0,
    },
  );
}

export function buildOAuthProviderFamilySelections(
  domain: ProviderFamilyDomain,
  currentSelections: ProviderFamilyConnectionSelectionSettings | null | undefined,
): ProviderFamilyConnectionSelectionSettings {
  return {
    ...currentSelections,
    [domain]: { kind: "individual-coding-plan" },
  };
}

export async function clearProviderFamilyDomain(
  settingService: Pick<ISettingService, "update">,
): Promise<void> {
  await settingService.update({
    providerFamilyDomain: "" as AppSettings["providerFamilyDomain"],
    providerFamilyDomainUpdatedAt: Date.now(),
    providerFamilyDomainMigrated: true,
  });
}
