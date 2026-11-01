import type { IServiceAccessor } from "@origin-ai/cf-services";

export function createSettingsTestServices(): IServiceAccessor {
  return {
    settingService: {
      get: async () => ({}),
      update: async () => {},
    },
  } as unknown as IServiceAccessor;
}
