import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isConversationSharePath,
  resolveConversationShareCodeFromPath,
} from "../src/share/conversationShareRoute.js";
import { resolveConversationShareRouteLocale } from "../src/share/conversationSharePreviewClient.js";

describe("conversation share route", () => {
  it("recognizes share paths without taking over remote routes", () => {
    expect(isConversationSharePath("/cn/share")).toBe(true);
    expect(isConversationSharePath("/cn/share/share-1")).toBe(true);
    expect(isConversationSharePath("/share")).toBe(true);
    expect(isConversationSharePath("/share/share-1")).toBe(true);
    expect(isConversationSharePath("/remote/v4")).toBe(false);
    expect(isConversationSharePath("/sharegate/x")).toBe(false);
  });

  it("English站的裸 /share/ 不再被Deny，两种Prefix都能解析出 code", () => {
    expect(resolveConversationShareCodeFromPath("/cn/share/share-1")).toBe("share-1");
    expect(resolveConversationShareCodeFromPath("/share/share-1")).toBe("share-1");
    expect(resolveConversationShareCodeFromPath("/cn/share/share-1/extra")).toBeNull();
    expect(resolveConversationShareCodeFromPath("/share/")).toBeNull();
  });

  it("Pages语言由路径PrefixDecide", () => {
    expect(resolveConversationShareRouteLocale("/cn/share/share-1")).toBe("zh-CN");
    expect(resolveConversationShareRouteLocale("/share/share-1")).toBe("en-US");
  });

  it("dev server base 不能写死 /cn/share/，否则English路由Local不可达", () => {
    const source = readFileSync("scripts/dev-web-share-env.mjs", "utf8");
    expect(source).toContain('"--base=/"');
    expect(source).not.toContain('"--base=/cn/share/"');
  });
});
