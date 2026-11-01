import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright-core";

test("未登录使用静态Table of Contents展示PersonalandTeam横幅", async () => {
  const browser = await chromium.connectOverCDP(
    process.env.CF_E2E_CDP_URL ?? "http://localhost:9229",
  );
  const page = browser
    .contexts()[0]
    .pages()
    .find((candidate) => candidate.url().includes("localhost:517"));
  assert.ok(page, "需要已Run的 CodeFusion Dev");
  const cdp = await page.context().newCDPSession(page);
  const originalClass = await page.locator("html").getAttribute("class");
  try {
    for (const width of [390, 1200]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      for (const theme of ["light", "dark"]) {
        await page.locator("html").evaluate((element, value) => {
          element.className = `${value} theme-cf-${value}`;
        }, theme);
        const body = await page.locator("body").innerText();
        assert.match(body, /Connect BigModel|Connect BigModel/);
        assert.match(body, /Disconnected|Disconnected|Not connected/);
        const buttons = await page.locator("button").allTextContents();
        assert.equal(
          buttons.some((text) => /Personal Plan|Personal Plan/.test(text)),
          true,
        );
        assert.equal(
          buttons.some((text) => /Team Plan|Team Plan/.test(text)),
          true,
        );
        assert.equal(buttons.filter((text) => /Team Plan|Team Plan/.test(text)).length, 1);
        assert.equal(
          buttons.some((text) => /Standard Edition|Advanced Edition/.test(text)),
          false,
        );
        assert.equal(
          buttons.some(
            (text) => /Personal Plan|Personal Plan|Team Plan|Team Plan/.test(text) && /150%/.test(text),
          ),
          false,
        );
        assert.match(body, /[¥￥]\s*598\.00/);
      }
    }
  } finally {
    await page.locator("html").evaluate((element, value) => {
      element.className = value ?? "";
    }, originalClass);
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await cdp.detach();
    await browser.close();
  }
});
