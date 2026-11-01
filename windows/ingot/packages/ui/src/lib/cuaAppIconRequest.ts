import type { ApplicationIconRequest } from "@origin-ai/cf-shared";

const APP_KEY_LOCATOR_KINDS = {
  darwin: "darwin-bundle-id",
  "windows-aumid": "windows-aumid",
  "windows-exe": "windows-executable-path",
} as const satisfies Record<string, ApplicationIconRequest["locators"][number]["kind"]>;

export function cuaAppKeyToIconRequest(
  appKey: string | undefined | null,
): ApplicationIconRequest | null {
  if (!appKey) return null;
  const separator = appKey.indexOf(":");
  if (separator <= 0) return null;
  const scheme = appKey.slice(0, separator);
  const value = appKey.slice(separator + 1).trim();
  if (!value) return null;
  const kind = (APP_KEY_LOCATOR_KINDS as Record<string, string | undefined>)[scheme];
  if (!kind) return null;
  return { locators: [{ kind, value } as ApplicationIconRequest["locators"][number]] };
}
