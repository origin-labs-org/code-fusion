import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WebRemoteControlRelayV2Device } from "@origin-ai/cf-shared/web-remote-relay";
import type {
  WebRemoteControlDeviceGroup,
  WebRemoteControlDeviceListView,
} from "#src/web-remote-control/index.js";

import {
  WebRemoteControlDeviceListPage,
  WebRemoteControlConnectionList,
} from "#src/web-remote-control/views.js";

const actions = { onSelect: () => {}, onRefresh: () => {}, onSwitchAccount: () => {} };

const connection = (
  sid: string,
  mid: string,
  meta: WebRemoteControlRelayV2Device["meta"],
  createdAt = 1,
): WebRemoteControlRelayV2Device => ({
  device_sid: sid,
  device_mid: mid,
  online: true,
  created_at: createdAt,
  meta,
});

const mac: WebRemoteControlDeviceGroup = {
  deviceMid: "abcdefgh-long",
  name: "MacBook",
  platform: "darwin",
  onlineConnections: [
    connection("on", "abcdefgh-long", { name: "MacBook", platform: "darwin", version: "3.15.0" }),
  ],
};
const homePc: WebRemoteControlDeviceGroup = {
  deviceMid: "12345678-long",
  name: "Home PC",
  platform: "linux",
  onlineConnections: [],
};
const unnamed: WebRemoteControlDeviceGroup = { deviceMid: "87654321-long", onlineConnections: [] };

function render(
  locale: "zh-CN" | "en-US",
  view: Partial<WebRemoteControlDeviceListView> & Pick<WebRemoteControlDeviceListView, "devices">,
) {
  return renderToStaticMarkup(
    createElement(WebRemoteControlDeviceListPage, {
      ...actions,
      locale,
      view: { kind: "devices", loading: false, error: false, ...view },
    }),
  );
}

describe("Connect前Devicelist", () => {
  it.each(["zh-CN", "en-US"] as const)(
    "%s 按Online/Offlinegrouping，Show平台与Version，Offline禁用且Default不ShowDevice ID",
    (locale) => {
      const zh = locale === "zh-CN";
      const html = render(locale, { devices: [mac, homePc, unnamed] });
      expect(html).toContain(zh ? "选择电脑" : "Choose a computer");
      expect(html).toMatch(new RegExp(`${zh ? "在线" : "Online"}<span[^>]*>1</span>`));
      expect(html).toMatch(new RegExp(`${zh ? "离线" : "Offline"}<span[^>]*>2</span>`));
      expect(html).toContain("macOS · CodeFusion 3.15.0");
      expect(html).toContain(zh ? "Linux · 离线" : "Linux · Offline");
      expect(html).toContain(zh ? "UntitledDevice" : "未命名设备");
      expect(html).toContain('data-device-platform-icon="darwin"');
      expect(html).toContain('data-device-platform-icon="linux"');
      expect(html).toContain('data-device-platform-icon="unknown"');
      expect(html).not.toContain("abcdefgh");
      expect(html).not.toContain("12345678");
      expect(html.match(/<button type="button" disabled=""[^>]*class="flex w-full/g)).toHaveLength(
        2,
      );
      expect(html).toContain(
        zh
          ? "没看到你的电脑？在电脑端 CodeFusion 登录同One账Number并开启Remote控制，然后Refresh。"
          : "Don&#x27;t see your computer?",
      );
    },
  );

  it("同组重名时Append MID 前 8 位区分，OtherDevice仍不Show ID", () => {
    const twin = { ...homePc, deviceMid: "fedcba98-long", name: "Home PC" };
    const html = render("zh-CN", { devices: [mac, homePc, twin] });
    expect(html).toContain("Linux · 离线 · ID 12345678");
    expect(html).toContain("Linux · 离线 · ID fedcba98");
    expect(html).not.toContain("abcdefgh");
  });

  it("账Number行ShowShow名与登录平台；读不到账Number时只Retain切换账Number按钮", () => {
    const withAccount = render("zh-CN", {
      devices: [mac],
      account: { displayName: "jyrong", provider: "bigmodel" },
    });
    expect(withAccount).toContain("jyrong · BigModel");
    expect(withAccount).toMatch(/>J<\/span>/);
    expect(withAccount).toContain(">切换</button>");
    const withoutAccount = render("en-US", { devices: [mac] });
    expect(withoutAccount).toContain(">Switch account</button>");
    expect(withoutAccount).not.toContain(" · Z.ai");
  });

  it.each(["zh-CN", "en-US"] as const)("%s 多个OnlineConnect只占One行，ShowConnectCount且可点开", (locale) => {
    const multi: WebRemoteControlDeviceGroup = {
      deviceMid: "abcdefgh-long",
      name: "Workstation",
      platform: "win32",
      onlineConnections: ["sid-one", "sid-two"].map((sid) =>
        connection(sid, "abcdefgh-long", { name: "Workstation", version: "3.14.1" }),
      ),
    };
    const html = render(locale, { devices: [multi] });
    expect(html.match(/<li>/g)).toHaveLength(1);
    expect(html).toContain(locale === "zh-CN" ? "2 个Connect" : "2 个连接");
    expect(html).toContain(">Windows</span>");
    expect(html).not.toContain("sid-one");
    expect(html).not.toContain('disabled=""');
  });

  it("多Connect选择行ShowVersion、Start时间与 SID 末 6 位，不展示Complete SID；RefreshMedium禁用", () => {
    const now = Date.UTC(2026, 8, 23, 12);
    const device: WebRemoteControlDeviceGroup = {
      deviceMid: "abcdefgh-long",
      name: "Workstation",
      platform: "win32",
      onlineConnections: [
        connection(
          "sid-alpha-a41f9c",
          "abcdefgh-long",
          { version: "3.15.0" },
          now / 1000 - 3 * 3600,
        ),
        connection(
          "e2e-device-alternative-with-a-long-connection-identifier",
          "abcdefgh-long",
          {},
          now / 1000 - 2 * 86_400,
        ),
      ],
    };
    const list = (locale: "zh-CN" | "en-US", disabled = false) =>
      renderToStaticMarkup(
        createElement(WebRemoteControlConnectionList, {
          device,
          locale,
          disabled,
          now,
          onSelect: () => {},
        }),
      );
    const zh = list("zh-CN");
    expect(zh).toContain("CodeFusion 3.15.0");
    expect(zh).toContain("3小时前Start · ID a41f9c");
    expect(zh).toContain(">CodeFusion</span>");
    expect(zh).toContain("前天Start · ID tifier");
    expect(zh).not.toContain("e2e-device-alternative");
    expect(list("en-US")).toContain("started 3 hours ago · ID a41f9c");
    expect(list("zh-CN", true).match(/disabled=""/g)).toHaveLength(2);
  });

  it("空listTo出同账Number开启远控Notice与Refresh按钮，加载andFailed不能冒充空态", () => {
    const empty = (loading: boolean, error: boolean) =>
      render("zh-CN", { devices: [], loading, error });
    expect(empty(false, false)).toContain("暂无Device");
    expect(empty(false, false)).toContain("在电脑端登录同One账Number并开启 Web Remote控制");
    expect(empty(false, false)).toContain(">刷新</button>");
    expect(empty(true, false)).toContain("In progress加载Device");
    expect(empty(true, false)).not.toContain("暂无Device");
    expect(empty(true, false)).toMatch(
      /aria-label="刷新"[^>]*disabled=""|disabled=""[^>]*aria-label="刷新"/,
    );
    expect(empty(false, true)).toContain("无法加载Device");
    expect(empty(false, true)).not.toContain("暂无Device");
  });

  it("RefreshMediumorRefreshFailed时Online行暂不Optional", () => {
    expect(render("zh-CN", { devices: [mac], loading: true }).match(/disabled=""/g)).toHaveLength(
      2,
    );
    expect(render("zh-CN", { devices: [mac], error: true }).match(/disabled=""/g)).toHaveLength(1);
  });
});
