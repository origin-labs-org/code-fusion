
export const officeRuntimeModule = {
  id: "office-runtime",
  requires: [],
  provides: ["office-runtime"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
