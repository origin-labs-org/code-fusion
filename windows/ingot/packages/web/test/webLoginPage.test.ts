// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WebLoginPage } from "../src/auth/WebLoginPage.js";

describe("Mobile Remote Control登录页", () => {
  it.each(["zh-CN", "en-US"] as const)("%s 页头ShowBrand与Local化登录Title", (lang) => {
    document.documentElement.lang = lang;
    const html = renderToStaticMarkup(createElement(WebLoginPage, { onLogin: () => {} }));
    expect(html).toContain("CodeFusion");
    expect(html).toContain(
      lang === "zh-CN" ? "登录后Continue使用 Web Remote控制" : "Sign In To Continue",
    );
  });
});
