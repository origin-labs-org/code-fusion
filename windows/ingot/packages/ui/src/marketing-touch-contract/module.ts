
export const marketingTouchControllerModule = {
  id: "marketing-touch-controller",
  requires: ["services", "shared", "ui"],
  provides: ["marketing-touch-controller"],
  publicEntrypoints: [
    "packages/ui/src/components/marketing-touch/marketingTouchController.ts",
    "packages/ui/src/marketing-touch-contract/contract.ts",
  ],
} as const;
