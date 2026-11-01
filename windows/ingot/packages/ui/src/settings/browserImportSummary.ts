import type { ChromeBrowserDataImportResult } from "@origin-ai/cf-shared";
import type { useCfIntl } from "@/i18n/IntlProvider.js";

export function formatImportSummary(
  result: ChromeBrowserDataImportResult,
  formatMessage: ReturnType<typeof useCfIntl>["intl"]["formatMessage"],
): string {
  if (!result.success) {
    const errorMessageId =
      result.error === "chrome_profile_not_found" ||
      result.error === "chrome_default_profile_not_found"
        ? "settings.browser.import.notFound"
        : result.error === "chrome_profile_ambiguous"
          ? "settings.browser.import.ambiguous"
          : result.error === "chrome_executable_not_found"
            ? "settings.browser.import.executableNotFound"
            : result.error === "chrome_cookie_access_denied"
              ? "settings.browser.import.accessDenied"
              : result.error === "chrome_cookie_elevation_required"
                ? "settings.browser.import.elevationRequired"
                : result.error === "chrome_cookie_elevation_cancelled"
                  ? "settings.browser.import.elevationCancelled"
                  : result.error === "chrome_cookie_helper_verification_failed"
                    ? "settings.browser.import.helperVerificationFailed"
                    : result.error === "chrome_cookie_app_bound_decryption_failed"
                      ? "settings.browser.import.appBoundFailed"
                      : result.error === "chrome_cookie_protection_unsupported"
                        ? "settings.browser.import.cookieProtected"
                        : result.error === "chrome_profile_locked"
                          ? "settings.browser.import.profileLocked"
                          : result.error === "chrome_local_storage_import_failed"
                            ? "settings.browser.import.localStorageFailed"
                            : "settings.browser.import.failed";
    return formatMessage({ id: errorMessageId });
  }
  const values = {
    cookies: String(result.cookies.imported),
    origins: String(result.localStorage.originsImported),
    entries: String(result.localStorage.entriesImported),
    skipped: String(result.cookies.skipped),
  };
  if (
    result.issues?.some((issue) =>
      [
        "chrome_cookie_elevation_required",
        "chrome_cookie_elevation_cancelled",
        "chrome_cookie_helper_verification_failed",
        "chrome_cookie_app_bound_decryption_failed",
      ].includes(issue),
    )
  ) {
    return formatMessage({ id: "settings.browser.import.partialAppBound" }, values);
  }
  return formatMessage({ id: "settings.browser.import.success" }, values);
}
