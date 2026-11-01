import type { AppSettings } from "@origin-ai/cf-shared";

export function normalizeSettingsPatch(patch: Partial<AppSettings>): Partial<AppSettings> {
  const normalizedPatch = { ...patch };

  if (
    "locale" in normalizedPatch &&
    !("localePreference" in normalizedPatch) &&
    typeof normalizedPatch.locale === "string"
  ) {
    normalizedPatch.localePreference = normalizedPatch.locale;
  }

  if (
    "terminalFontFamily" in normalizedPatch &&
    typeof normalizedPatch.terminalFontFamily === "string"
  ) {
    const trimmedTerminalFontFamily = normalizedPatch.terminalFontFamily.trim();
    normalizedPatch.terminalFontFamily =
      trimmedTerminalFontFamily.length > 0 ? trimmedTerminalFontFamily : undefined;
  }

  if ("integratedTerminalShell" in normalizedPatch) {
    const selection = normalizedPatch.integratedTerminalShell;
    if (selection?.mode === "auto") {
      normalizedPatch.integratedTerminalShell = undefined;
    } else if (selection?.mode === "shell") {
      normalizedPatch.integratedTerminalShell = {
        ...selection,
        id: selection.id.trim(),
        label: selection.label.trim(),
        path: selection.path.trim(),
      };
    }
  }

  if ("httpProxy" in normalizedPatch && typeof normalizedPatch.httpProxy === "string") {
    const trimmedHttpProxy = normalizedPatch.httpProxy.trim();
    normalizedPatch.httpProxy = trimmedHttpProxy.length > 0 ? trimmedHttpProxy : undefined;
  }

  if (
    "httpProxyNoProxy" in normalizedPatch &&
    typeof normalizedPatch.httpProxyNoProxy === "string"
  ) {
    const trimmedHttpProxyNoProxy = normalizedPatch.httpProxyNoProxy.trim();
    normalizedPatch.httpProxyNoProxy =
      trimmedHttpProxyNoProxy.length > 0 ? trimmedHttpProxyNoProxy : undefined;
  }

  if (
    "httpProxyCaCertPath" in normalizedPatch &&
    typeof normalizedPatch.httpProxyCaCertPath === "string"
  ) {
    const trimmedHttpProxyCaCertPath = normalizedPatch.httpProxyCaCertPath.trim();
    normalizedPatch.httpProxyCaCertPath =
      trimmedHttpProxyCaCertPath.length > 0 ? trimmedHttpProxyCaCertPath : undefined;
  }

  if (
    "cfEndpointOrigin" in normalizedPatch &&
    typeof normalizedPatch.cfEndpointOrigin === "string"
  ) {
    const trimmedCfEndpointOrigin = normalizedPatch.cfEndpointOrigin.trim();
    normalizedPatch.cfEndpointOrigin =
      trimmedCfEndpointOrigin.length > 0 ? trimmedCfEndpointOrigin : undefined;
  }

  if (
    "providerFamilyDomain" in normalizedPatch &&
    typeof normalizedPatch.providerFamilyDomain === "string"
  ) {
    const trimmedProviderFamilyDomain = normalizedPatch.providerFamilyDomain.trim();
    normalizedPatch.providerFamilyDomain =
      trimmedProviderFamilyDomain.length > 0 ? normalizedPatch.providerFamilyDomain : undefined;
  }

  if (
    "dynamicWorkflowMode" in normalizedPatch &&
    (normalizedPatch.dynamicWorkflowMode as string | undefined) === ""
  ) {
    normalizedPatch.dynamicWorkflowMode = undefined;
  }

  return normalizedPatch;
}
