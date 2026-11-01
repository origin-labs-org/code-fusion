import type { EmbeddedBrowserPermissionContract } from "@desktop/main/embedded-browser-permission-contract/contract.js";

export function exampleEmbeddedBrowserPermission(
  contract: EmbeddedBrowserPermissionContract,
  ...args: Parameters<EmbeddedBrowserPermissionContract["applyEmbeddedBrowserPermissionPolicy"]>
) {
  return contract.applyEmbeddedBrowserPermissionPolicy(...args);
}
