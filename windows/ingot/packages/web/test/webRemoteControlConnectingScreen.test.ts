import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WebRemoteControlLoadingScreen } from "#src/web-remote-control/views.js";

const render = (props: Parameters<typeof WebRemoteControlLoadingScreen>[0]) =>
  renderToStaticMarkup(createElement(WebRemoteControlLoadingScreen, props));

describe("Connect过程页", () => {
  it.each(["zh-CN", "en-US"] as const)("%s ShowTarget电脑、平台图Label与CurrentPhase", (locale) => {
    const html = render({
      state: "authenticating",
      locale,
      device: { name: "Alice’s MacBook", platform: "darwin" },
    });
    expect(html).toContain(
      locale === "zh-CN" ? "In progressConnect Alice’s MacBook" : "正在连接 Alice’s MacBook",
    );
    expect(html).toContain(locale === "zh-CN" ? "In progress认证Device…" : "正在认证设备…");
    expect(html).toContain('data-device-platform-icon="darwin"');
    expect(html.match(/data-step-state="done"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="step"[^>]*data-step-state="active"/);
  });

  it("没有名Characterand平台时用通用Copy与电脑图Label；Reconnect不High亮进度并Additional explanation", () => {
    const html = render({ state: "reconnecting", locale: "zh-CN" });
    expect(html).toContain("In progressConnect电脑");
    expect(html).toContain('data-device-platform-icon="unknown"');
    expect(html).toContain("Connection interrupted，In progressReconnect…");
    expect(html).toContain("Networkor休眠恢复后会AutoReconnect，请稍候。");
    expect(html.match(/data-step-state="idle"/g)).toHaveLength(4);
    expect(html).not.toContain('aria-current="step"');
  });

  it("配对Completed进入最后One段", () => {
    const html = render({ state: "paired", locale: "en-US", device: { name: "PC" } });
    expect(html).toContain("Paired. Loading workspace…");
    expect(html.match(/data-step-state="done"/g)).toHaveLength(3);
  });
});
