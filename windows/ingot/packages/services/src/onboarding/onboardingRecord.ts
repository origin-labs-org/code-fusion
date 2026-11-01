import type {
  OnboardingRecordEntry,
  OnboardingRecordEntryInput,
  OnboardingRecordFile,
  OnboardingDecision,
} from "@origin-ai/cf-shared";
import { ServiceChannels, type AppSettings } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface OnboardingSettingsSyncPatch {
  onboardingOccupation?: AppSettingsPatchOccupation;
  proactiveSuggestionsEnabled?: boolean;
  memoryEnabled?: boolean;
}

type AppSettingsPatchOccupation = NonNullable<AppSettings["onboardingOccupation"]>;

export interface IOnboardingRecordService {
  
  appendRecord(deviceMid: string, entry: OnboardingRecordEntryInput): Promise<void>;
  
  shouldOnboard(deviceMid: string): Promise<boolean>;
  
  dismissOnboarding(deviceMid: string): Promise<void>;
  
  claimAnonymousRecord(): Promise<void>;
  
  getLatestEntry(): Promise<OnboardingRecordEntry | null>;
  
  syncSettingsFromRecord(): Promise<OnboardingSettingsSyncPatch | null>;
  
  updateRecordPreferences(
    patch: Partial<
      Pick<OnboardingRecordEntryInput, "memoryEnabled" | "proactiveSuggestionsEnabled">
    >,
  ): Promise<void>;
  
  getRecords(): Promise<OnboardingRecordFile | null>;
  
  clearRecords(): Promise<void>;
}

export interface CreateOnboardingRecordServiceOptions {
  loadUserId: () => Promise<string | null>;
  hasExistingLocalTask: () => Promise<boolean>;
}

export type OnboardingRecordServiceFactory = (
  options: CreateOnboardingRecordServiceOptions,
) => IOnboardingRecordService;

export const IOnboardingRecordService = createServiceDescriptor<IOnboardingRecordService>(
  ServiceChannels.OnboardingRecord,
);

export type {
  OnboardingDecision,
  OnboardingRecordEntry,
  OnboardingRecordEntryInput,
  OnboardingRecordFile,
};
