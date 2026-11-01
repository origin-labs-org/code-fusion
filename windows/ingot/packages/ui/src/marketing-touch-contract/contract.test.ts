import { expectTypeOf, it } from "vitest";
import type { MarketingTouchControllerContract } from "@/marketing-touch-contract/contract.js";
import { exampleMarketingTouchController } from "@/marketing-touch-contract/contract.example.js";

it("保持既有入口的返回类型", () => {
  expectTypeOf<ReturnType<typeof exampleMarketingTouchController>>().toEqualTypeOf<
    ReturnType<MarketingTouchControllerContract["createMarketingTouchController"]>
  >();
});
