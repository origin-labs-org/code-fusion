const PROVIDER_CONFIG_POLLING_SETTLE_MS = 2_000;

export async function waitForProviderConfigPolling(): Promise<void> {
  await browser.pause(PROVIDER_CONFIG_POLLING_SETTLE_MS);
}
