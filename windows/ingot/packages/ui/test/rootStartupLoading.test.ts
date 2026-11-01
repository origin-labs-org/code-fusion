import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RootStartupLoading, CfStartupLogoBadge } from "@/root/RootStartupLoading.js";

describe("RootStartupLoading", () => {
  it("静态品牌图标不渲染呼吸动画", () => {
    const html = renderToStaticMarkup(createElement(CfStartupLogoBadge, { animated: false }));
    expect(html).toContain("<svg");
    expect(html).not.toContain("<animate");
  });
  it("Startup blocking state uses a pulsing CodeFusion SVG instead of visible loading text", () => {
    const html = renderToStaticMarkup(createElement(RootStartupLoading, { label: "加载中..." }));

    expect(html).toContain('data-testid="root-startup-loading"');
    expect(html).toContain('aria-label="加载中..."');
    expect(html).toContain("<svg");
    expect(html).toContain('attributeName="opacity"');
    expect(html).not.toContain(">加载中...<");
  });
});
