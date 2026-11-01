import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { createDeviceSwitchDesktopBridge } from "./remote-device-switch.helpers.mjs";
import { setup, assertEventually } from "./remote-login-v2.helpers.mjs";

const origin = process.env.REMOTE_LOGIN_E2E_ORIGIN || "http://127.0.0.1:5178";
const artifacts = resolve(".tmp/remote-home-only-workspaces-e2e");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const remote = (name, extra = {}) => ({
  workspacePath: `/srv/${name}`,
  workspaceIdentity: `remote:ssh:e2e:/srv/${name}`,
  label: `E2E_${name.toUpperCase()}`,
  kind: "remote",
  connectionState: "disconnected",
  ...extra,
});
try {
  for (const width of [390, 1024])
    for (const theme of ["cf-light", "cf-dark"])
      for (const locale of ["zh-CN", "en-US"]) {
        const h = await setup(browser, { width, theme, locale, signedIn: true });
        const { page } = h;
        page.setDefaultTimeout(15_000);
        const zh = locale === "zh-CN";
        const text = {
          offline: zh ? "Disconnected · Connect" : "Not connected · Connect",
          failed: zh ? "Connection failed · Connect" : "Connection failed · Connect",
          online: zh ? "已连接" : "Connected",
          toast: zh ? "连接失败" : "Connection failed",
        };
        const workspaces = [
          remote("alpha"),
          remote("beta", { lastConnectionError: "E2E_SSH_REFUSED" }),
        ];
        const traffic = { lists: 0, reconnects: [], bridgeOpens: [] };
        let bridge;
        const send = (socket, payload) => socket.send(JSON.stringify({ type: "data", payload }));
        await page.routeWebSocket(/\/api\/v1\/remote\/ws2(?:\?|$)/, (socket) => {
          socket.onClose(() => bridge?.dispose());
          socket.onMessage((raw) => {
            const message = JSON.parse(String(raw));
            if (message.type === "auth_init")
              socket.send(
                JSON.stringify({
                  type: "auth_ack",
                  device_sid: message.device_sid,
                  pair_status: "matched",
                }),
              );
            if (message.type === "pair_status_query")
              socket.send(JSON.stringify({ type: "pair_status_ack", pair_status: "matched" }));
            const payload = message.payload;
            if (payload?.cf_type === "rpc-frame" || payload?.cf_type === "rpc-frame-ack") {
              bridge?.acceptPayload(payload);
              return;
            }
            if (payload?.cf_type === "bootstrap-request")
              send(socket, {
                cf_type: "bootstrap-response",
                requestId: payload.requestId,
                success: true,
                result: {
                  windowControlSessionId: "e2e-device",
                  desktopAppVersion: "3.13.0",
                  workspaces,
                },
              });
            if (payload?.cf_type === "workspace-list-request") {
              traffic.lists++;
              send(socket, {
                cf_type: "workspace-list-response",
                requestId: payload.requestId,
                success: true,
                result: { workspaces },
              });
            }
            if (payload?.cf_type === "workspace-reconnect-request") {
              traffic.reconnects.push(payload.workspaceKey);
              const target = workspaces.find(
                (item) => item.workspaceIdentity === payload.workspaceKey,
              );
              if (target.label === "E2E_BETA") {
                send(socket, {
                  cf_type: "workspace-reconnect-response",
                  requestId: payload.requestId,
                  workspaceKey: payload.workspaceKey,
                  success: false,
                  error: "E2E_SSH_REFUSED",
                });
                return;
              }
              Object.assign(target, {
                connectionState: "connected",
                remoteSessionId: "remote-alpha",
              });
              send(socket, { cf_type: "workspace-list-updated", result: { workspaces } });
              send(socket, {
                cf_type: "workspace-reconnect-response",
                requestId: payload.requestId,
                workspaceKey: payload.workspaceKey,
                success: true,
              });
            }
            if (payload?.cf_type === "workspace-bridge-open") {
              traffic.bridgeOpens.push(payload.workspaceKey);
              const target = workspaces.find(
                (item) => item.workspaceIdentity === payload.workspaceKey,
              );
              const ready = {
                ...target,
                workspaceKey: target.workspaceIdentity,
                bridgeSessionId: payload.bridgeSessionId,
                bridgeGeneration: payload.bridgeGeneration,
              };
              send(socket, {
                cf_type: "workspace-bridge-ready",
                requestId: payload.requestId,
                bridgeSessionId: payload.bridgeSessionId,
                bridgeGeneration: payload.bridgeGeneration,
                bridge: ready,
              });
              bridge = createDeviceSwitchDesktopBridge(socket, ready, { locale, theme });
            }
          });
        });
        const section = page.getByTestId("home-only-workspaces");
        const row = (label) => section.locator("[data-home-only-workspace]", { hasText: label });
        try {
          const url = new URL("/remote/v4?app_version=3.13.0&sid=e2e-device&mid=e2e-mid", origin);
          url.searchParams.set("name", "E2E Mac");
          await page.goto(url.href);
          const onboarding = page.getByTestId("onboarding-page");
          await onboarding.waitFor();
          await onboarding.getByRole("button", { name: /ExitOnboarding|Exit onboarding/ }).click();
          const welcome = page.getByRole("dialog", { name: /欢迎使用 CodeFusion|Welcome to CodeFusion/ });
          await welcome.waitFor();
          await welcome.getByRole("button", { name: /^(Close|Close)$/ }).click();
          await welcome.waitFor({ state: "detached" });
          await section.waitFor();
          await row("E2E_ALPHA").waitFor();
          assert.match(await row("E2E_ALPHA").innerText(), new RegExp(text.offline));
          assert.match(await row("E2E_BETA").innerText(), new RegExp(text.failed));
          assert.equal(await page.getByText("project.service-unavailable").count(), 0);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
          );
          const filename = `home-only-${width}-${theme}-${locale}.png`;
          await page.screenshot({ path: resolve(artifacts, filename), fullPage: true });

          const listsBeforeFailure = traffic.lists;
          await row("E2E_BETA").click();
          await page.getByText(text.toast, { exact: true }).first().waitFor();
          await section
            .locator("[data-home-only-workspace]:not([disabled])", { hasText: "E2E_BETA" })
            .waitFor();
          assert.equal(traffic.lists, listsBeforeFailure);

          await row("E2E_ALPHA").click();
          await row("E2E_ALPHA").filter({ hasText: text.online }).waitFor();
          assert.deepEqual(traffic.reconnects, [
            "remote:ssh:e2e:/srv/beta",
            "remote:ssh:e2e:/srv/alpha",
          ]);
          assert.equal(traffic.bridgeOpens.length, 0);

          await row("E2E_ALPHA").click();
          await assertEventually(() => traffic.bridgeOpens.length === 1);
          assert.equal(traffic.bridgeOpens[0], "remote:ssh:e2e:/srv/alpha");
          await section.waitFor({ state: "detached" });
          assert.deepEqual(h.errors, []);
          results.push({ width, theme, locale, result: "passed", screenshot: filename });
        } catch (error) {
          await page.screenshot({ path: resolve(artifacts, "failure.png"), fullPage: true });
          console.error(await page.locator("body").innerText(), h.errors);
          throw error;
        } finally {
          await h.context.close();
        }
      }
  await writeFile(resolve(artifacts, "results.json"), JSON.stringify(results, null, 2));
  console.log(`HO01 passed: ${results.length} configurations; ${artifacts}`);
} finally {
  await browser.close();
}
