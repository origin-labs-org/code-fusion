export interface SettingUpdatedEvent {
  readonly keys: readonly string[];
}

interface AccountProviderInvalidationOptions {
  readonly onDidUpdateSetting: (listener: (event: SettingUpdatedEvent) => void) => () => void;
  readonly refresh: (reason: string) => Promise<unknown>;
}

const ACCOUNT_PROVIDER_SETTING_KEYS = new Set([
  "providerFamilyDomain",
  "providerFamilyConnectionSelections",
  "cfEndpointOrigin",
]);

export function bindAccountProviderInvalidation(
  options: AccountProviderInvalidationOptions,
): () => void {
  const requestRefresh = (reason: string): void => {
    void options.refresh(reason).catch(() => {
    });
  };
  const disposeSetting = options.onDidUpdateSetting((event) => {
    const keys = event.keys.filter((key) => ACCOUNT_PROVIDER_SETTING_KEYS.has(key));
    if (keys.length > 0) {
      requestRefresh(`settings:${keys.join(",")}`);
    }
  });

  return () => {
    disposeSetting();
  };
}
