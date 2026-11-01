import type { AppSettings } from "@origin-ai/cf-shared";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export type WorkspaceSettingsProjection = Pick<
  AppSettings,
  "lastActiveWorkspace" | "lastWorkspaceSession" | "recentProjects" | "lastActiveTabIndex"
>;

export interface ISettingService {
  get(): Promise<AppSettings>;
  
  update(
    patch: Partial<AppSettings>,
    expectedAccountSettings?: Pick<
      AppSettings,
      | "providerFamilyDomain"
      | "providerFamilyConnectionSelections"
      | "providerFamilyDomainUpdatedAt"
    >,
  ): Promise<void>;
  /** Change the data base directory: copy data from old → new location, then persist the setting. */
  updateDataBaseDir(newDir: string | undefined): Promise<void>;
}

export const ISettingService = createServiceDescriptor<ISettingService>(ServiceChannels.Setting);
