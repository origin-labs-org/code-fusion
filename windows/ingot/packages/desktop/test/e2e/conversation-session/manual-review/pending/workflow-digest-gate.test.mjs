import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";

test("Display bottom card immediately when a run exists, without waiting for main agent reply to finish", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => {
      process.stderr.write(String(error));
    });
    const targets = await (await fetch("http://localhost:9229/json/list")).json();
    const origin = new URL(targets.find((t) => t.type === "page").url).origin;
    await page.route("**/__workflow_hover", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
      await import('/@fs${process.cwd()}/packages/ui/test/fixtures/workflow-digest-gate.fixture.tsx');
    </script>`,
      }),
    );
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${origin}/__workflow_hover`);
      const card = page.locator('[data-workflow-run-digest="true"]');
      await page.getByRole("button", { name: "Join run" }).waitFor();
      assert.equal(await card.count(), 0);
      await page.getByRole("button", { name: "Join run" }).click();
      await card.waitFor();
      assert.equal(await card.count(), 1);
      await page.getByRole("button", { name: "Finish reply" }).click();
      assert.equal(await card.count(), 1);
    }
  } finally {
    await browser.close();
  }
});
