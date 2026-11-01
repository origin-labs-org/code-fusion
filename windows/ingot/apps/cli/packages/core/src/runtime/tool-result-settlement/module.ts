
export const toolResultSettlementModule = {
  id: "tool-result-settlement",
  requires: ["cf-cli"],
  provides: ["tool-result-settlement"],
  publicEntrypoints: ["../methods/tool-result-settlement.ts", "contract.ts"],
} as const;
