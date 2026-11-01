import type { MarketingTouchControllerContract } from "@/marketing-touch-contract/contract.js";

export function exampleMarketingTouchController(
  contract: MarketingTouchControllerContract,
  ...args: Parameters<MarketingTouchControllerContract["createMarketingTouchController"]>
) {
  return contract.createMarketingTouchController(...args);
}
