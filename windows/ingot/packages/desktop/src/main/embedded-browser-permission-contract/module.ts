
export const embeddedBrowserPermissionModule = {
  id: "embedded-browser-permission",
  requires: ["desktop", "shared"],
  provides: ["embedded-browser-permission"],
  publicEntrypoints: [
    "packages/desktop/src/main/embeddedBrowserPermissionPolicy.ts",
    "packages/desktop/src/main/embedded-browser-permission-contract/contract.ts",
  ],
} as const;
