export const mobileUiModule = {
  id: "mobile-ui",
  requires: ["ui"],
  provides: ["mobile-ui"],
  publicEntrypoints: [
    "index.ts",
    "contract.ts",
    "DevicePlatformIcon.tsx",
    "CfAppLogo.tsx",
    "bottom-sheet.tsx",
  ],
} as const;
