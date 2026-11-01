import { expectTypeOf, it } from "vitest";
import { settleToolResults } from "../../src/runtime/methods/tool-result-settlement.js";
import type { ToolResultSettlement } from "../../src/runtime/tool-result-settlement/contract.js";

it("沿用原结算方法的调用方、参数及异步返回契约", () => {
  expectTypeOf(settleToolResults).toEqualTypeOf<ToolResultSettlement>();
  expectTypeOf<ReturnType<ToolResultSettlement>>().toEqualTypeOf<Promise<void>>();
});
