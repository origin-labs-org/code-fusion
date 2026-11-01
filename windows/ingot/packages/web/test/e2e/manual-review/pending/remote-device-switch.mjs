import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { createDeviceSwitchDesktopBridge } from "./remote-device-switch.helpers.mjs";
import { setup, mixedDevices, assertEventually } from "./remote-login-v2.helpers.mjs";

const origin = process.env.REMOTE_LOGIN_E2E_ORIGIN || "http://127.0.0.1:5178";
const artifacts = resolve(".tmp/remote-device-switch-e2e");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const longName = "Alice’s MacBook Pro — R&D与Tests工作站 / Development workstation";
try {
  for (const width of process.env.REMOTE_DEVICE_E2E_WIDTH
    ? [Number(process.env.REMOTE_DEVICE_E2E_WIDTH)]
    : [390, 1024])
    for (const mode of ["home-only", "bridge"])
      for (const theme of ["cf-light", "cf-dark"])
        for (const locale of ["zh-CN", "en-US"]) {
          const h = await setup(browser, { width, theme, locale, signedIn: true });
          const { page } = h;
          page.setDefaultTimeout(15_000);
          const connections = [];
          const send = (socket, payload) => socket.send(JSON.stringify({ type: "data", payload }));
          await page.routeWebSocket(/\/api\/v1\/remote\/ws2(?:\?|$)/, (socket) => {
            const connection = { socket, sid: undefined, closed: false, holdBootstrap: false };
            connections.push(connection);
            socket.onClose(() => {
              connection.closed = true;
              connection.bridge?.dispose();
            });
            socket.onMessage((raw) => {
              const message = JSON.parse(String(raw));
              if (message.type === "auth_init") {
                connection.sid = message.device_sid;
                const device = mixedDevices.find((item) => item.device_sid === connection.sid);
                assert.ok(device?.online);
                assert.equal(new URL(socket.url()).searchParams.get("mid"), device.device_mid);
                socket.send(
                  JSON.stringify({
                    type: "auth_ack",
                    device_sid: connection.sid,
                    pair_status: "matched",
                  }),
                );
              }
              if (message.type === "pair_status_query")
                socket.send(JSON.stringify({ type: "pair_status_ack", pair_status: "matched" }));
              const payload = message.payload;
              if (payload?.cf_type === "rpc-frame" || payload?.cf_type === "rpc-frame-ack") {
                connection.bridge?.acceptPayload(payload);
                return;
              }
              const workspace = {
                workspacePath: "/workspace/device-switch",
                workspaceIdentity: `remote:ssh:${connection.sid}:/workspace/device-switch`,
                label: `E2E_DEVICE_${connection.sid}`,
                kind: "remote",
                connectionState: mode === "bridge" ? "connected" : "disconnected",
                ...(mode === "bridge" ? { remoteSessionId: `remote-${connection.sid}` } : {}),
              };
              connection.result ??= { workspaces: [workspace] };
              if (payload?.cf_type === "workspace-bridge-open") {
                const bridge = {
                  ...workspace,
                  workspaceKey: workspace.workspaceIdentity,
                  bridgeSessionId: payload.bridgeSessionId,
                  bridgeGeneration: payload.bridgeGeneration,
                };
                send(socket, {
                  cf_type: "workspace-bridge-ready",
                  requestId: payload.requestId,
                  bridgeSessionId: payload.bridgeSessionId,
                  bridgeGeneration: payload.bridgeGeneration,
                  bridge,
                });
                connection.bridge = createDeviceSwitchDesktopBridge(socket, bridge, {
                  locale,
                  theme,
                });
              }
              if (payload?.cf_type === "bootstrap-request") {
                const response = {
                  cf_type: "bootstrap-response",
                  requestId: payload.requestId,
                  success: true,
                  result: {
                    windowControlSessionId: connection.sid,
                    desktopAppVersion: "3.13.0",
                    ...connection.result,
                  },
                };
                if (connection.holdBootstrap) connection.pendingBootstrap = response;
                else send(socket, response);
              }
              if (payload?.cf_type === "workspace-list-request")
                send(socket, {
                  ...(connection.failList
                    ? {
                        cf_type: "app-error",
                        reason: "unexpected-error",
                        error: "E2E_REFRESH_FAILED",
                      }
                    : {
                        cf_type: "workspace-list-response",
                        success: true,
                        result: connection.result,
                      }),
                  requestId: payload.requestId,
                });
            });
          });
          const hasBridgeSession = (sid) =>
            page.evaluate(
              async ({ url, sid }) => {
                const store = await import(url);
                return Boolean(store.getRemoteWorkspaceSession(`remote-${sid}`));
              },
              {
                url: `/@fs${resolve("packages/ui/src/store/remoteWorkspaceSessionStore.ts")}`,
                sid,
              },
            );
          const buttonName = () => (locale === "zh-CN" ? "切换Device" : "Switch device");
          const waitForHome = async (name) => {
            const button = page.getByRole("button", { name: buttonName(), exact: true });
            const onboarding = page.getByTestId("onboarding-page");
            const welcome = page.getByRole("dialog", { name: /欢迎使用 CodeFusion|Welcome to CodeFusion/ });
            if (mode === "home-only") await onboarding.waitFor();
            else await button.or(onboarding).or(welcome).first().waitFor();
            if (await onboarding.isVisible()) {
              await onboarding.getByRole("button", { name: /ExitOnboarding|Exit onboarding/ }).click();
            }
            await button.or(welcome).first().waitFor();
            if (await welcome.isVisible())
              await welcome.getByRole("button", { name: /^(Close|Close)$/ }).click();
            await button.waitFor();
            await button.getByText(name, { exact: true }).waitFor();
            const navigation = page.getByTestId("sidebar-primary-navigation");
            assert.equal(
              await navigation.evaluate(
                (node, label) => node.firstElementChild?.ariaLabel === label,
                buttonName(),
              ),
              true,
              "Device行必须Yes导航首行，位于“New Task”之上",
            );
            const [rowHeight, nameClipped] = await button.evaluate((node) => {
              const label = node.querySelector("span");
              return [node.getBoundingClientRect().height, label.scrollWidth > label.clientWidth];
            });
            assert.equal(rowHeight, 32);
            assert.equal(nameClipped, name === longName);
            return button;
          };
          try {
            const url = new URL("/remote/v4?app_version=3.13.0&sid=e2e-device&mid=e2e-mid", origin);
            url.searchParams.set("name", longName);
            await page.goto(url.href);
            const button = await waitForHome(longName);
            assert.equal(h.traffic.lists, 0, "扫码Connect不先Request账NumberDevicelist");
            if (mode === "bridge") assert.equal(await hasBridgeSession("e2e-device"), true);
            await page.evaluate(() => document.fonts.ready);
            assert.equal(
              await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
              false,
            );
            const filename = `connected-${width}-${mode}-${theme}-${locale}.png`;
            await page.screenshot({ path: resolve(artifacts, filename), fullPage: true });
            const first = connections[0];
            first.holdBootstrap = true;
            first.socket.send(JSON.stringify({ type: "pair_status_ack", pair_status: "waiting" }));
            first.socket.send(JSON.stringify({ type: "pair_status_ack", pair_status: "matched" }));
            await assertEventually(() => Boolean(first.pendingBootstrap));
            await button.click();
            await page.getByRole("heading", { name: /选择电脑|Choose a computer/ }).waitFor();
            await assertEventually(() => first.closed);
            if (mode === "bridge") assert.equal(await hasBridgeSession("e2e-device"), false);
            send(first.socket, first.pendingBootstrap);
            assert.equal(new URL(page.url()).searchParams.has("sid"), false);
            assert.equal(new URL(page.url()).searchParams.has("name"), false);
            assert.equal(new URL(page.url()).searchParams.get("app_version"), "3.13.0");
            assert.equal(
              await page.evaluate(() => localStorage.getItem("cf-web-remote-last-device-sid")),
              "e2e-device",
            );
            await page.getByRole("button", { name: /Alice’s MacBook/ }).waitFor();
            await page.getByRole("button", { name: /^(Refresh|Refresh)$/ }).click();
            await assertEventually(() => h.traffic.lists === 2);
            assert.equal(connections.length, 1, "RecentDevice仍Online，listandRefresh也不能Auto连回去");
            assert.equal(h.traffic.tokens, 1);
            await page.getByRole("button", { name: /Workstation/ }).click();
            await waitForHome("Workstation");
            assert.equal(new URL(page.url()).searchParams.get("sid"), "second");
            assert.equal(new URL(page.url()).searchParams.get("mid"), "d67e89f0-other");
            assert.equal(connections.length, 2);
            assert.equal(connections[1].sid, "second");
            if (mode === "bridge") {
              assert.equal(await hasBridgeSession("e2e-device"), false);
              assert.equal(await hasBridgeSession("second"), true);
            }
            assert.equal(await page.getByText(`E2E_DEVICE_e2e-device`, { exact: true }).count(), 0);
            await page.reload();
            await waitForHome("Workstation");
            assert.equal(connections.at(-1).sid, "second");
            assert.equal(h.traffic.lists, 2, "Refresh按New SID 直连，不重New选Device");
            assert.deepEqual(h.errors, []);
            results.push({
              width,
              mode,
              theme,
              locale,
              result: "passed",
              screenshot: filename,
            });
          } catch (error) {
            await page.screenshot({ path: resolve(artifacts, "failure.png"), fullPage: true });
            console.error(await page.locator("body").innerText(), h.errors);
            throw error;
          } finally {
            await h.context.close();
          }
        }
  await writeFile(resolve(artifacts, "results.json"), JSON.stringify(results, null, 2));
  console.log(`MD07 passed: ${results.length} configurations; ${artifacts}`);
} finally {
  await browser.close();
}
