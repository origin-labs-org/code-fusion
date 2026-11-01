export const webRemoteControlUiModule = {
  id: "web-remote-control-ui",
  requires: ["mobile-ui", "services", "shared", "ui"],
  provides: ["web-remote-control-ui"],
  publicEntrypoints: [
    "index.ts",
    "contract.ts",
    "WebRemoteControlDeviceHeader.tsx",
    "app/useWebRemoteControlAuthSync.ts",
  ],
} as const;
