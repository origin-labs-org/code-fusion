import { expectTypeOf, it } from "vitest";
import type { EmbeddedBrowserPermissionContract } from "@desktop/main/embedded-browser-permission-contract/contract.js";
import { exampleEmbeddedBrowserPermission } from "@desktop/main/embedded-browser-permission-contract/contract.example.js";

it("保持既有入口的返回类型", () => {
  expectTypeOf<ReturnType<typeof exampleEmbeddedBrowserPermission>>().toEqualTypeOf<
    ReturnType<EmbeddedBrowserPermissionContract["applyEmbeddedBrowserPermissionPolicy"]>
  >();
});
