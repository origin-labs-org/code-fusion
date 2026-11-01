import { mkdir, writeFile } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { resolve } from "node:path";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  prepareSSHConnectionPage,
  readRemoteTabSnapshot,
  type SSHConnectionConfig,
} from "../../../helpers/ssh-remote-p0.js";
import { waitForV4ConversationState } from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_SSH_BANNER_RECONNECT";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/ssh-remote-banner-reconnect",
);
const BANNER = '[data-testid="remote-conversation-banner"]';
const WIZARD = '[data-testid="ssh-dialog"]';

type ProxyMode = "forward" | "reset" | "close";

interface ResettingSSHProxy {
  port: number;
  
  setMode(mode: ProxyMode): void;
  close(): Promise<void>;
}

async function createResettingSSHProxy(
  config: Pick<SSHConnectionConfig, "host" | "port">,
): Promise<ResettingSSHProxy> {
  let mode: ProxyMode = "forward";
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  const server: Server = createServer((client) => {
    track(client);
    if (mode === "reset") {
      client.resetAndDestroy();
      return;
    }
    if (mode === "close") {
      client.end();
      return;
    }
    const upstream = createConnection({ host: config.host, port: config.port });
    track(upstream);
    const closeBoth = () => {
      client.destroy();
      upstream.destroy();
    };
    client.once("error", closeBoth);
    upstream.once("error", closeBoth);
    upstream.once("connect", () => client.pipe(upstream).pipe(client));
    client.once("close", () => upstream.destroy());
    upstream.once("close", () => client.destroy());
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error(`${CASE_MARKER}: 代理没有拿到端口`));
        return;
      }
      resolvePort(address.port);
    });
  });
  return {
    port,
    setMode(next) {
      mode = next;
      if (next === "reset") for (const socket of sockets) socket.resetAndDestroy();
      if (next === "close") for (const socket of sockets) socket.end();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

async function waitForBannerFailed(): Promise<{ state: string | null; text: string }> {
  let banner = await readBannerText();
  await browser
    .waitUntil(
      async () => {
        banner = await readBannerText();
        return banner.state === "failed";
      },
      { interval: 1000, timeout: 180_000, timeoutMsg: "banner-failed" },
    )
    .catch((error: unknown) => {
      throw new Error(
        `${CASE_MARKER}: 恢复Budget耗尽后横幅没有进入Failed态: ${JSON.stringify(banner)}`,
        { cause: error },
      );
    });
  return banner;
}

async function readBannerText(): Promise<{ state: string | null; text: string }> {
  return browser.execute((selector) => {
    const banner = document.querySelector<HTMLElement>(selector);
    return {
      state: banner?.getAttribute("data-connection-state") ?? null,
      text: (banner?.innerText ?? "").replace(/\s+/gu, " ").trim(),
    };
  }, BANNER);
}

async function clickButtonByText(container: string, pattern: RegExp, label: string) {
  await browser.waitUntil(
    () =>
      browser.execute(
        (selector, source, flags) => {
          const regex = new RegExp(source, flags);
          const button = Array.from(
            document.querySelectorAll<HTMLButtonElement>(`${selector} button`),
          ).find((item) => regex.test(item.innerText.trim()) && !item.disabled);
          button?.click();
          return Boolean(button);
        },
        container,
        pattern.source,
        pattern.flags,
      ),
    { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: 没有可点击的 ${label}` },
  );
}

describe(`${CASE_MARKER}: Online断连耗尽恢复Budget后的Error归类与横幅Reconnect`, () => {
  let provider: SSHLifecycleProvider | null = null;
  let proxy: ResettingSSHProxy | null = null;
  let reconnectedTaskId: string | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "banner-reconnect.json"), JSON.stringify(facts, null, 2));
    await proxy?.close().catch(() => undefined);
    proxy = null;
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("RDUX-09-banner-wizard Banner shows unable to connect to host after link reset; after recovery, banner reconnect -> wizard retry returns to original session", async function () {
    this.timeout(20 * 60_000);
    await prepareSSHConnectionPage(CASE_MARKER);
    const prepared = await prepareSSHLifecycle(CASE_MARKER);
    provider = prepared.provider;
    const [workspaceA] = prepared.config.workspacePaths;
    proxy = await createResettingSSHProxy(prepared.config);
    const config: SSHConnectionConfig = { ...prepared.config, port: proxy.port };

    const task = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    facts.task = { taskId: task.taskId, identity: task.identity, session: task.remoteSessionId };

    proxy.setMode("reset");
    const banner = await waitForBannerFailed();
    facts.bannerAfterBudgetExhausted = banner;
    await browser
      .saveScreenshot(resolve(artifactDir, "budget-exhausted.png"))
      .catch(() => undefined);
    expect(banner.text).toContain("检查设备地址和端口");
    expect(banner.text).not.toContain("不满足安装要求");
    expect(banner.text).not.toContain("环境检查失败");
    expect((await readRemoteTabSnapshot(task.identity)).remoteSessionId).toBeNull();

    proxy.setMode("forward");
    await clickButtonByText(BANNER, /^(Reconnect|Reconnect)$/iu, "横幅重连按钮");
    await $(WIZARD).waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: `${CASE_MARKER}: Failed态Reconnect没有打开向导`,
    });
    await clickButtonByText(WIZARD, /^(Retry|Retry)$/iu, "向导重试按钮");

    let restored = await readRemoteTabSnapshot(task.identity);
    await browser.waitUntil(
      async () => {
        restored = await readRemoteTabSnapshot(task.identity);
        return (
          Boolean(restored.remoteSessionId) && restored.remoteSessionId !== task.remoteSessionId
        );
      },
      {
        interval: 1000,
        timeout: 180_000,
        timeoutMsg: `${CASE_MARKER}: 向导Retry后远端 workspace 没有换代上线`,
      },
    );
    facts.restoredSession = restored.remoteSessionId;
    await browser.waitUntil(async () => !(await $(WIZARD).isExisting()), {
      timeout: 30_000,
      timeoutMsg: `${CASE_MARKER}: 向导Connected successfully后没有Close`,
    });
    const conversation = await waitForV4ConversationState(
      (snapshot) => snapshot.taskId === task.taskId,
      `${CASE_MARKER}: 向导ReconnectCompleted后没有回到原Session（进入了空白NewTask）`,
      60_000,
    );
    facts.conversationAfterReconnect = conversation;
    await browser.saveScreenshot(resolve(artifactDir, "reconnected.png")).catch(() => undefined);
    expect(await readBannerText()).toMatchObject({ state: null });
    reconnectedTaskId = task.taskId;
  });

  it("RDUX-09-banner-handshake-lost When closed normally before handshake (no system error code), banner prompts auto-recovery stopped, not spoofing installation pre-check failure", async function () {
    this.timeout(10 * 60_000);
    if (!proxy || !reconnectedTaskId) {
      throw new Error(`${CASE_MARKER}: 依赖上One条用例把原SessionReconnect上线`);
    }
    proxy.setMode("close");
    const banner = await waitForBannerFailed();
    facts.bannerAfterHandshakeLost = banner;
    await browser
      .saveScreenshot(resolve(artifactDir, "handshake-lost-exhausted.png"))
      .catch(() => undefined);
    expect(banner.text).toContain("Please view details, follow instructions, and try again");
    expect(banner.text).not.toContain("不满足安装要求");
    expect(banner.text).not.toContain("环境检查失败");
    proxy.setMode("forward");
  });
});
