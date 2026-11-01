import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { setup, assertEventually } from "./remote-login-v2.helpers.mjs";

const origin = process.env.REMOTE_LOGIN_E2E_ORIGIN || "http://127.0.0.1:5178";
const artifacts = resolve(".tmp/remote-device-groups-e2e");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const nowSeconds = Math.floor(Date.now() / 1000);
const current = {
  device_sid: "e2e-device",
  device_mid: "e2e-mid-first",
  online: true,
  created_at: nowSeconds - 3 * 3600,
  meta: { name: "Alice’s MacBook", platform: "darwin", version: "3.14.1" },
};
const alternate = {
  ...current,
  device_sid: "e2e-device-alternative-with-a-long-connection-identifier",
  created_at: nowSeconds - 2 * 86_400,
  meta: { name: "Alice’s MacBook", platform: "darwin", version: "3.14.2" },
};
const otherMachine = {
  ...current,
  device_sid: "other-machine",
  device_mid: "e2e-mid-second",
  online: false,
  meta: {},
};
const history = Array.from({ length: 11 }, (_, i) => ({
  ...current,
  device_sid: `history-${i}`,
  online: false,
  meta: {},
}));

try {
  for (const width of [390, 1024])
    for (const theme of ["cf-light", "cf-dark"])
      for (const locale of ["zh-CN", "en-US"])
        for (const screen of ["single", "multiple", "offline"]) {
          const selected = screen === "multiple" ? alternate : current;
          const devices = [
            ...history,
            screen === "offline" ? { ...current, online: false, meta: {} } : current,
            ...(screen === "multiple" ? [alternate] : []),
            otherMachine,
          ];
          const h = await setup(browser, {
            width,
            theme,
            locale,
            signedIn: true,
            devices,
            expectedDeviceSid: selected.device_sid,
            expectedDeviceMid: selected.device_mid,
          });
          try {
            await h.page.goto(`${origin}/remote/v4?app_version=3.14.1`);
            const rows = h.page.locator("main li");
            await rows.first().waitFor();
            assert.equal(await rows.count(), 2);
            assert.equal(h.traffic.tokens, 0);
            const row = rows.first().getByRole("button");
            assert.equal(await rows.first().getByRole("button").count(), 1);
            assert.equal(await rows.last().getByRole("button").isDisabled(), true);
            if (screen === "offline") assert.equal(await row.isDisabled(), true);
            else assert.match(await rows.first().innerText(), /Alice’s MacBook/);
            if (screen === "multiple")
              assert.match(await rows.first().innerText(), /2 个Connect|2 connections/);
            assert.equal(
              await h.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
              false,
            );
            await h.page.evaluate(() => document.fonts.ready);
            const screenshot = `${screen}-${width}-${theme}-${locale}.png`;
            await h.page.screenshot({ path: resolve(artifacts, screenshot), fullPage: true });

            if (screen === "multiple") {
              let mode = "pending";
              const pending = Promise.withResolvers();
              await h.page.route("**/api/v1/remote/device", async (route) => {
                h.traffic.lists++;
                if (mode === "pending") {
                  await pending.promise;
                  await route.fulfill({ status: 503 });
                } else {
                  await route.fulfill({ json: { code: 0, msg: "", data: [...devices].reverse() } });
                }
              });
              await h.page.getByRole("button", { name: /^(Refresh|Refresh)$/ }).click();
              await assertEventually(() => h.traffic.lists === 2);
              assert.equal(await row.isDisabled(), true);
              pending.resolve();
              await h.page.getByRole("alert").waitFor();
              assert.equal(await row.isDisabled(), true);
              assert.equal(h.traffic.tokens, 0);
              mode = "success";
              await h.page.getByRole("button", { name: /^(Refresh|Refresh)$/ }).click();
              await h.page.getByRole("alert").waitFor({ state: "hidden" });
              await assertEventually(() => h.traffic.lists === 3);
              await h.page.getByRole("button", { name: /^(Refresh|Refresh)$/ }).waitFor();
              for (let attempt = 0; attempt < 50 && (await row.isDisabled()); attempt++)
                await h.page.waitForTimeout(100);
              assert.equal(await row.isDisabled(), false);
              assert.equal(await rows.count(), 2);
            }
            if (screen !== "offline") {
              await row.focus();
              await h.page.keyboard.press("Enter");
              if (screen === "multiple") {
                const sheet = h.page.getByRole("dialog");
                await sheet.waitFor();
                const dialogStyle = await sheet.evaluate((element) => {
                  const probe = document.createElement("div");
                  probe.className = "bg-popover border-popover-border rounded-t-2xl";
                  document.body.append(probe);
                  const actual = getComputedStyle(element);
                  const expected = getComputedStyle(probe);
                  const result = {
                    actual: [
                      actual.backgroundColor,
                      actual.borderTopColor,
                      actual.borderTopLeftRadius,
                    ],
                    expected: [
                      expected.backgroundColor,
                      expected.borderTopColor,
                      expected.borderTopLeftRadius,
                    ],
                  };
                  probe.remove();
                  return result;
                });
                assert.deepEqual(dialogStyle.actual, dialogStyle.expected);
                const connections = sheet.locator("ul button");
                assert.equal(await connections.count(), 2);
                assert.match(await connections.nth(1).innerText(), /3\.14\.2/);
                assert.doesNotMatch(await sheet.innerText(), /e2e-device-alternative/);
                await h.page.evaluate(() => document.fonts.ready);
                await h.page.screenshot({
                  path: resolve(artifacts, `sheet-${width}-${theme}-${locale}.png`),
                  animations: "disabled",
                });
                await connections.nth(1).focus();
                await h.page.keyboard.press("Enter");
              }
              await assertEventually(() => h.traffic.sockets === 1);
              await h.page
                .getByRole("heading", { name: /该Device不属于Current账Number|This device does not belong/ })
                .waitFor();
              const url = new URL(h.page.url());
              assert.equal(url.searchParams.get("sid"), selected.device_sid);
              assert.equal(url.searchParams.get("mid"), selected.device_mid);
              assert.equal(url.searchParams.get("name"), selected.meta.name);
              assert.equal(url.searchParams.get("app_version"), "3.14.1");
              assert.equal(
                await h.page.evaluate(() =>
                  localStorage.getItem("cf-web-remote-last-device-sid"),
                ),
                selected.device_sid,
              );
              assert.equal(
                await h.page.evaluate(() =>
                  localStorage.getItem("cf-web-remote-last-device-mid"),
                ),
                selected.device_mid,
              );
              assert.equal(h.traffic.tokens, 1);
            }
            assert.deepEqual(h.errors, []);
            results.push({ screen, width, theme, locale, screenshot, result: "passed" });
          } finally {
            await h.context.close();
          }
        }
} finally {
  await browser.close();
  await writeFile(resolve(artifacts, "results.json"), JSON.stringify(results, null, 2));
  await writeFile(
    resolve(artifacts, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Remote device groups</title>${results.map((r) => `<figure><figcaption>${r.screen} · ${r.width} · ${r.theme} · ${r.locale}</figcaption><img src="${r.screenshot}" style="max-width:100%"></figure>`).join("\n")}`,
  );
}
console.log(JSON.stringify({ passed: results.length, artifacts }, null, 2));
