import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { setup, assertEventually } from "./remote-login-v2.helpers.mjs";

const origin = process.env.REMOTE_LOGIN_E2E_ORIGIN || "http://127.0.0.1:5178";
const artifacts = resolve(".tmp/remote-abort-api-compat-e2e");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const missing of [["any"], ["timeout"], ["any", "timeout"]])
    for (const entry of ["qr", "list"])
      for (const width of [390, 1024])
        for (const theme of ["cf-light", "cf-dark"]) {
          const locale = theme === "cf-light" ? "zh-CN" : "en-US";
          const h = await setup(browser, {
            width,
            theme,
            locale,
            signedIn: true,
            relayError: null,
          });
          const label = `${missing.join("-")}-${entry}-${width}-${theme}`;
          try {
            await h.context.addInitScript((names) => {
              for (const name of names)
                Object.defineProperty(AbortSignal, name, { configurable: true, value: undefined });
              Object.defineProperty(AbortSignal.prototype, "throwIfAborted", { value: undefined });
            }, missing);
            const path =
              entry === "qr"
                ? "/remote/v4?sid=e2e-device&mid=e2e-mid&name=E2E_COMPAT&app_version=3.16.1"
                : "/remote/v4?app_version=3.16.1";
            await h.page.goto(`${origin}${path}`);
            if (entry === "list") {
              const device = h.page.getByRole("button", { name: /Alice’s MacBook/ });
              await device.waitFor();
              assert.equal(h.traffic.tokens, 0);
              assert.equal(h.traffic.sockets, 0);
              await h.page.screenshot({ path: resolve(artifacts, `${label}-list.png`) });
              await device.click();
            }
            await assertEventually(() => h.traffic.bootstraps === 1);
            assert.equal(h.traffic.lists, entry === "list" ? 1 : 0);
            assert.equal(h.traffic.tokens, 1);
            assert.equal(h.traffic.sockets, 1);
            assert.equal(new URL(h.page.url()).searchParams.get("sid"), "e2e-device");
            assert.deepEqual(
              await h.page.evaluate(
                (names) => names.map((name) => typeof AbortSignal[name]),
                missing,
              ),
              missing.map(() => "undefined"),
            );
            assert.deepEqual(h.errors, []);
            await h.page.screenshot({ path: resolve(artifacts, `${label}-paired.png`) });
            results.push({
              case: "ML08",
              missing,
              entry,
              width,
              theme,
              locale,
              traffic: h.traffic,
              result: "passed",
            });
          } catch (error) {
            await h.page.screenshot({ path: resolve(artifacts, `${label}-failed.png`) });
            results.push({
              case: "ML08",
              missing,
              entry,
              width,
              theme,
              traffic: h.traffic,
              errors: h.errors,
              result: "failed",
            });
            throw error;
          } finally {
            await h.context.close();
          }
        }
} finally {
  await writeFile(resolve(artifacts, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(`Passed ${results.length} compatibility checks; evidence: ${artifacts}`);
