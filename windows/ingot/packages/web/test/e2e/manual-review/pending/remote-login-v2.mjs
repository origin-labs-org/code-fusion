import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import {
  setup,
  mixedDevices,
  assertEventually,
  checkSwitchConfirmation,
} from "./remote-login-v2.helpers.mjs";

const origin = process.env.REMOTE_LOGIN_E2E_ORIGIN || "http://127.0.0.1:5178";
const artifacts = resolve(".tmp/remote-login-v2-e2e");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const qrPath = "/remote/v4?app_version=3.13.0&sid=e2e-device&mid=e2e-mid&name=E2E";

try {
  for (const width of [390, 1024])
    for (const theme of ["cf-light", "cf-dark"])
      for (const locale of ["zh-CN", "en-US"])
        for (const screen of ["login", "devices", "empty", "device-not-owned"]) {
          const h = await setup(browser, {
            width,
            theme,
            locale,
            signedIn: screen !== "login",
            devices: screen === "empty" ? [] : mixedDevices,
          });
          const isList = screen === "devices" || screen === "empty";
          try {
            await h.page.goto(`${origin}${isList ? "/remote/v4" : qrPath}`);
            const title =
              screen === "login"
                ? locale === "zh-CN"
                  ? "登录后Continue使用 Web Remote控制"
                  : "Sign In To Continue"
                : isList
                  ? locale === "zh-CN"
                    ? "选择电脑"
                    : "Choose a computer"
                  : locale === "zh-CN"
                    ? "该Device不属于Current账Number"
                    : "This device does not belong to this account";
            await h.page.getByRole("heading", { name: title, exact: true }).waitFor();
            if (screen === "login") {
              assert.deepEqual(
                await h.page.getByRole("button").allTextContents(),
                locale === "zh-CN"
                  ? ["Connect Z.ai Continue使用全球", "Connect BigModel Continue使用Medium国"]
                  : ["Connect to Z.aiGlobal", "Connect to BigModelCN"],
              );
            }
            if (isList) {
              await h.page
                .getByRole("button", { name: /^(Refresh|Refresh)$/ })
                .first()
                .waitFor();
              await h.page
                .getByText(
                  screen === "empty"
                    ? locale === "zh-CN"
                      ? "暂无Device"
                      : "No devices yet"
                    : "Alice’s MacBook",
                  { exact: true },
                )
                .waitFor();
              assert.equal(h.traffic.lists, 1);
              if (screen === "devices") {
                const rows = h.page.locator("main ul button");
                assert.match(await rows.nth(0).innerText(), /Alice’s MacBook/);
                assert.match(await rows.nth(1).innerText(), /Workstation/);
                assert.equal(await rows.nth(2).isDisabled(), true);
                const opacities = await rows.evaluateAll((elements) =>
                  elements.map((element) => getComputedStyle(element.firstElementChild).opacity),
                );
                assert.notEqual(opacities[0], opacities[2], "Offline行应弱化");
                assert.match(await h.page.locator("main").innerText(), /E2E · Z\.ai/);
              }
            }
            await h.page.evaluate(() => document.fonts.ready);
            assert.equal(
              await h.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
              false,
            );
            assert.equal(h.traffic.tokens, screen === "device-not-owned" ? 1 : 0);
            assert.equal(h.traffic.sockets, screen === "device-not-owned" ? 1 : 0);
            assert.deepEqual(h.errors, []);
            const filename = `${screen}-${width}-${theme}-${locale}.png`;
            await h.page.screenshot({ path: resolve(artifacts, filename), fullPage: true });
            if (screen === "device-not-owned") {
              assert.equal(
                await h.page
                  .getByRole("button", { name: /选择OtherDevice|Choose another device/ })
                  .count(),
                1,
              );
            }
            if (screen === "device-not-owned" || screen === "devices")
              results.push(
                await checkSwitchConfirmation(h, { screen, width, theme, locale, artifacts }),
              );
            results.push({ screen, width, theme, locale, screenshot: filename, result: "passed" });
          } finally {
            await h.context.close();
          }
        }

  const selection = await setup(browser, { signedIn: true, relayError: null });
  try {
    await selection.page.goto(`${origin}/remote/v4?app_version=3.13.0`);
    await selection.page.getByRole("button", { name: /Alice’s MacBook/ }).waitFor();
    assert.equal(selection.traffic.lists, 1);
    await selection.page.getByRole("button", { name: "刷新", exact: true }).click();
    await assertEventually(() => selection.traffic.lists === 2);
    const refresh = selection.page.getByRole("button", { name: "刷新", exact: true });
    for (let attempt = 0; attempt < 50 && (await refresh.isDisabled()); attempt++)
      await selection.page.waitForTimeout(100);
    assert.equal(await refresh.isDisabled(), false);
    await selection.page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(selection.traffic.lists, 2);
    await selection.page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await assertEventually(() => selection.traffic.lists === 3);
    await selection.page.getByRole("button", { name: /Alice’s MacBook/ }).click();
    await assertEventually(() => selection.traffic.bootstraps === 1);
    assert.deepEqual(Object.fromEntries(new URL(selection.page.url()).searchParams), {
      app_version: "3.13.0",
      sid: "e2e-device",
      mid: "e2e-mid",
      name: "Alice’s MacBook",
    });
    assert.equal(
      await selection.page.evaluate(() => localStorage.getItem("cf-web-remote-last-device-sid")),
      "e2e-device",
    );
    await selection.page.reload();
    await assertEventually(() => selection.traffic.bootstraps === 2);
    assert.equal(selection.traffic.lists, 3);
    assert.deepEqual(selection.errors, []);
    results.push({ case: "MD01 listThree种Refresh与选择；MD02 Refresh恢复", result: "passed" });
  } finally {
    await selection.context.close();
  }

  for (const lastSid of ["e2e-device", "offline", "other-account-device"]) {
    const h = await setup(browser, { signedIn: true, relayError: null, lastSid });
    try {
      await h.page.goto(`${origin}/remote/v4?app_version=3.13.0`);
      if (lastSid === "e2e-device") await assertEventually(() => h.traffic.bootstraps === 1);
      else {
        await h.page.getByRole("button", { name: /Alice’s MacBook/ }).waitFor();
        assert.equal(h.traffic.tokens, 0);
      }
      assert.equal(h.traffic.lists, 1);
      assert.deepEqual(h.errors, []);
      results.push({ case: `MD03 RecentDevice ${lastSid}`, result: "passed" });
    } finally {
      await h.context.close();
    }
  }

  const other = await setup(browser, { signedIn: true, lastSid: "e2e-device" });
  try {
    await other.page.goto(`${origin}${qrPath}`);
    await other.page.getByRole("button", { name: "选择OtherDevice", exact: true }).click();
    await other.page.getByRole("button", { name: /Alice’s MacBook/ }).waitFor();
    assert.equal(other.traffic.tokens, 1);
    assert.equal(other.traffic.lists, 1);
    assert.deepEqual(Object.fromEntries(new URL(other.page.url()).searchParams), {
      app_version: "3.13.0",
    });
    assert.equal(await other.page.evaluate(() => localStorage.getItem("cfjwttoken")), "e2e-jwt");
    await other.page.getByRole("button", { name: "切换", exact: true }).click();
    await other.page.getByRole("button", { name: "Exit并切换", exact: true }).click();
    await other.page.getByRole("button", { name: /Connect Z.ai Continue使用/ }).waitFor();
    assert.equal(await other.page.evaluate(() => localStorage.getItem("cfjwttoken")), null);
    assert.deepEqual(other.errors, []);
    results.push({ case: "MD04 Failed页换DeviceSkipRecent直连；MD05 list切换账Number", result: "passed" });
  } finally {
    await other.context.close();
  }

  const shortScreen = await setup(browser, {
    signedIn: true,
    height: 300,
    relayError: null,
    devices: Array.from({ length: 12 }, (_, index) => ({
      ...mixedDevices[2],
      device_sid: index === 0 ? "e2e-device" : `device-${index}`,
      device_mid: index === 0 ? "e2e-mid" : `mid-${index}`,
      meta: { name: `Computer ${String(index).padStart(2, "0")}` },
    })),
  });
  try {
    await shortScreen.page.goto(`${origin}/remote/v4`);
    await shortScreen.page.getByRole("button", { name: /Computer 11/ }).waitFor();
    const geometry = await shortScreen.page.locator("main").evaluate((main) => {
      main.scrollTop = main.scrollHeight;
      return {
        scrollTop: main.scrollTop,
        lastBottom: main.querySelector("li:last-child").getBoundingClientRect().bottom,
        viewport: innerHeight,
      };
    });
    assert.ok(geometry.scrollTop > 0);
    assert.ok(geometry.lastBottom <= geometry.viewport);
    const firstRow = shortScreen.page.getByRole("button", { name: /Computer 00/ });
    const unfocused = await firstRow.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await shortScreen.page.getByRole("button", { name: "刷新", exact: true }).focus();
    await shortScreen.page.keyboard.press("Tab");
    await shortScreen.page.keyboard.press("Tab");
    assert.equal(await firstRow.evaluate((element) => element === document.activeElement), true);
    assert.notEqual(
      await firstRow.evaluate((element) => getComputedStyle(element).backgroundColor),
      unfocused,
    );
    await shortScreen.page.keyboard.press("Enter");
    await assertEventually(() => shortScreen.traffic.bootstraps === 1);
    assert.deepEqual(shortScreen.errors, []);
    results.push({ case: "MD06 矮屏Longlist末行可达、键盘焦点与选择", result: "passed" });
  } finally {
    await shortScreen.context.close();
  }

  const switched = await setup(browser, {
    signedIn: true,
    initialProvider: "zai",
    provider: "bigmodel",
  });
  try {
    await switched.page.goto(`${origin}${qrPath}`);
    await switched.page.getByRole("button", { name: "切换账Number", exact: true }).click();
    await switched.page.getByRole("button", { name: "Exit并切换", exact: true }).click();
    await switched.page.getByRole("button", { name: /Connect BigModel Continue使用/ }).click();
    await assertEventually(() => !!switched.traffic.authorize);
    assert.equal(switched.traffic.authorize.pathname, "/login");
    const state = switched.traffic.authorize.searchParams.get("state");
    const payload = JSON.parse(Buffer.from(state, "base64url").toString());
    assert.equal(payload.app_return_to, `${origin}${qrPath}`);
    const callback = new URL(switched.traffic.authorize.searchParams.get("redirect"));
    assert.equal(callback.search, new URL(qrPath, origin).search);
    const redirectUri = callback.toString();
    callback.searchParams.set("authCode", "e2e-code");
    callback.searchParams.set("state", state);
    await switched.page.goto(`${origin}${callback.pathname}${callback.search}`);
    await switched.page.waitForURL(`${origin}${qrPath}`);
    assert.equal(switched.traffic.exchange.redirect_uri, redirectUri);
    assert.equal(
      await switched.page.evaluate(() => localStorage.getItem("oauth:active_provider")),
      "bigmodel",
    );
    assert.equal(
      await switched.page.evaluate(() => localStorage.getItem("oauth:zai:access_token")),
      null,
    );
    assert.deepEqual(switched.errors, []);
    results.push({ case: "ML03 归属Failed后切到 BigModel 并回原扫码地址", result: "passed" });
  } finally {
    await switched.context.close();
  }

  for (const path of ["/remote/v4", "/remote/__test__"])
    for (const signedIn of [false, true])
      for (const width of [390, 1024])
        for (const provider of ["zai", "bigmodel"]) {
          const login = await setup(browser, { relayError: null, provider, width, signedIn });
          const loginQrPath = qrPath.replace("/remote/v4", path);
          try {
            if (signedIn) {
              await login.page.route(
                "**/api/v1/remote/token",
                async (route) => {
                  login.traffic.tokens++;
                  await route.fulfill({ status: 401, json: { code: 1001, msg: "unauthorized" } });
                },
                { times: 1 },
              );
            }
            await login.page.goto(`${origin}${loginQrPath}`);
            await login.page.getByRole("button", { name: /Connect Z.ai Continue使用/ }).waitFor();
            assert.equal(await login.page.getByRole("dialog").count(), 0);
            assert.equal(login.page.url(), `${origin}${loginQrPath}`);
            assert.equal(
              await login.page.evaluate(() => localStorage.getItem("cfjwttoken")),
              null,
            );
            assert.equal(login.traffic.tokens, signedIn ? 1 : 0);
            assert.equal(login.traffic.sockets, 0);
            await login.page
              .getByRole("button", {
                name: provider === "zai" ? /Connect Z.ai Continue使用/ : /Connect BigModel Continue使用/,
              })
              .click();
            await assertEventually(() => !!login.traffic.authorize);
            const state = login.traffic.authorize.searchParams.get("state");
            const redirectUri = login.traffic.authorize.searchParams.get(
              provider === "zai" ? "redirect_uri" : "redirect",
            );
            const callback = new URL(redirectUri);
            assert.equal(callback.pathname, "/remote/v4");
            assert.equal(callback.search, new URL(loginQrPath, origin).search);
            if (provider === "bigmodel") {
              assert.equal(
                login.traffic.authorize.origin,
                process.env.REMOTE_LOGIN_E2E_BIGMODEL_ORIGIN || "https://bigmodel.cn",
              );
              assert.equal(login.traffic.authorize.pathname, "/login");
              assert.equal(login.traffic.authorize.searchParams.get("appId"), "cf");
              assert.equal(login.traffic.authorize.searchParams.has("redirect_uri"), false);
            }
            const payload = JSON.parse(Buffer.from(state, "base64url").toString());
            assert.equal(payload.app_return_to, `${origin}${loginQrPath}`);
            await login.page.goto(`${origin}/remote/v4`);
            assert.equal(
              await login.page.evaluate(
                () => JSON.parse(localStorage.getItem("oauth_pending_logins"))[0].provider,
              ),
              provider,
            );
            callback.searchParams.set(provider === "bigmodel" ? "authCode" : "code", "e2e-code");
            callback.searchParams.set("state", state);
            await login.page.goto(`${origin}${callback.pathname}${callback.search}`);
            await login.page.waitForURL(`${origin}${loginQrPath}`);
            await assertEventually(() => login.traffic.bootstraps === 1);
            assert.equal(login.traffic.tokens, signedIn ? 2 : 1);
            assert.equal(login.traffic.sockets, 1);
            assert.equal(
              await login.page.evaluate(() => localStorage.getItem("cfjwttoken")),
              "e2e-jwt",
            );
            assert.equal(
              await login.page.evaluate(() => localStorage.getItem("oauth:active_provider")),
              provider,
            );
            assert.equal(
              await login.page.evaluate(
                (p) => localStorage.getItem(`oauth:${p}:access_token`),
                provider,
              ),
              "e2e-access",
            );
            assert.equal(
              await login.page.evaluate(() => localStorage.getItem("oauth_pending_logins")),
              null,
            );
            assert.equal(login.traffic.exchange.provider, provider);
            assert.equal(login.traffic.exchange.redirect_uri, redirectUri);
            assert.deepEqual(login.errors, []);
            results.push({
              case: `ML04 ${path} ${provider} ${width}px ${signedIn ? "401重登" : "首次登录"}Retain回调参Count并配对`,
              result: "passed",
            });
          } finally {
            await login.context.close();
          }
        }

  for (const provider of ["zai", "bigmodel"]) {
    const login = await setup(browser, { relayError: null, provider });
    const callbackPage = await login.context.newPage();
    callbackPage.on("pageerror", (error) => login.errors.push(error.message));
    try {
      await login.page.goto(`${origin}${qrPath}`);
      await login.page
        .getByRole("button", {
          name: provider === "zai" ? /Connect Z.ai Continue使用/ : /Connect BigModel Continue使用/,
        })
        .click();
      await assertEventually(() => !!login.traffic.authorize);
      const redirectUri = login.traffic.authorize.searchParams.get(
        provider === "zai" ? "redirect_uri" : "redirect",
      );
      const callback = new URL(redirectUri);
      callback.searchParams.set(provider === "bigmodel" ? "authCode" : "code", "e2e-code");
      callback.searchParams.set("state", login.traffic.authorize.searchParams.get("state"));
      await callbackPage.goto(`${origin}${callback.pathname}${callback.search}`);
      await callbackPage.waitForURL(`${origin}${qrPath}`);
      await assertEventually(() => login.traffic.bootstraps === 1);
      assert.equal(login.traffic.exchange.provider, provider);
      assert.equal(login.traffic.exchange.redirect_uri, redirectUri);
      assert.equal(
        await callbackPage.evaluate(() => localStorage.getItem("cfjwttoken")),
        "e2e-jwt",
      );
      assert.equal(
        await callbackPage.evaluate(() => localStorage.getItem("oauth_pending_logins")),
        null,
      );
      assert.deepEqual(login.errors, []);
      results.push({ case: `ML07 ${provider} 回调落在NewTags页仍Completed登录并配对`, result: "passed" });
    } finally {
      await callbackPage.screenshot({ path: resolve(artifacts, `ml07-${provider}.png`) });
      await login.context.close();
    }
  }

  for (const provider of ["zai", "bigmodel"])
    for (const tokenStatus of [200, 401]) {
      const h = await setup(browser, { signedIn: true, tokenStatus, relayError: null, provider });
      try {
        await h.page.goto(`${origin}${qrPath}`);
        if (tokenStatus === 200) await assertEventually(() => h.traffic.bootstraps === 1);
        else {
          await h.page.getByRole("button", { name: /Connect Z.ai Continue使用/ }).waitFor();
          assert.equal(await h.page.evaluate(() => localStorage.getItem("cfjwttoken")), null);
          assert.equal(h.page.url(), `${origin}${qrPath}`);
          assert.equal(h.traffic.sockets, 0);
          await h.page.getByRole("button", { name: /Connect BigModel Continue使用/ }).click();
          await assertEventually(() => !!h.traffic.authorize);
          assert.equal(h.traffic.authorize.pathname, "/login");
          const state = JSON.parse(
            Buffer.from(h.traffic.authorize.searchParams.get("state"), "base64url").toString(),
          );
          assert.equal(state.app_return_to, `${origin}${qrPath}`);
        }
        assert.deepEqual(h.errors, []);
        results.push({
          case: `${provider} ${tokenStatus === 200 ? "ML05 已登录直连" : "ML06 token401回登录Retain原URL"}`,
          result: "passed",
        });
      } finally {
        await h.context.close();
      }
    }
} finally {
  await writeFile(resolve(artifacts, "results.json"), JSON.stringify(results, null, 2));
  const shots = results.filter((result) => result.screenshot);
  await writeFile(
    resolve(artifacts, "index.html"),
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Relay V2 手机入口Screenshot矩阵</title><style>body{margin:24px;background:#eee;color:#222;font:14px system-ui}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}figure{margin:0;background:white;padding:12px}img{width:100%;height:422px;object-fit:contain}figcaption{margin-bottom:12px}a{color:inherit}</style><h1>Relay V2 手机入口Screenshot矩阵</h1><p>受控 OAuth / relay，LocalBrowserEvidence。Devicelist16张，登录与归属Failed16张，切换账Number确认16张。</p><main>${shots.map((shot) => `<figure><figcaption>${shot.screen} · ${shot.width}px · ${shot.theme} · ${shot.locale}</figcaption><a href="${shot.screenshot}"><img src="${shot.screenshot}" alt="${shot.screen}"></a></figure>`).join("")}</main></html>`,
  );
  await browser.close();
}
console.log(`Passed ${results.length} checks; screenshots: ${artifacts}`);
