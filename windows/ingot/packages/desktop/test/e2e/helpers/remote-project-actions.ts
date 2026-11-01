import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { clickTestIdByDom, readSettings, waitForTestIdByDom } from "./desktop-app.js";
import {
  readRemoteTabSnapshot,
  waitForRemoteTab,
  waitForSSHDirectoryStep,
} from "./ssh-remote-p0.js";
import { selectTaskOrganizeMode } from "./workspace-agent-warmup.js";

export async function disconnectRemoteSource(
  sourceId: string,
  caseMarker: string,
  options: { workspaceIdentities?: readonly string[] } = {},
): Promise<void> {
  await clickRemoteSourceAction(sourceId, caseMarker, ["断开", "Disconnect"]);
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, { timeout: 15_000 });
  await selectTaskOrganizeMode(["项目", "Project"]);
  const identities = options.workspaceIdentities;
  if (identities?.length) {
    let latest: Array<{ identity: string; status: string | null }> = [];
    try {
      await browser.waitUntil(
        async () => {
          latest = await browser.execute(
            (identities) =>
              identities.map((identity) => ({
                identity,
                status:
                  document.querySelector<HTMLElement>(
                    `[data-project-workspace-identity=${JSON.stringify(identity)}]`,
                  )?.dataset.connectionState ?? null,
              })),
            identities,
          );
          return latest.every((project) => project.status === "offline");
        },
        { timeout: 30_000, timeoutMsg: `${caseMarker}: Target project is not offline` },
      );
    } catch (cause) {
      throw new Error(`${caseMarker}: Target project is not offline；latest=${JSON.stringify(latest)}`, { cause });
    }
  }
}

export async function connectRemoteSourceFromSettings(
  sourceId: string,
  caseMarker: string,
): Promise<void> {
  await clickRemoteSourceAction(sourceId, caseMarker, ["连接", "Connect"]);
}

async function clickRemoteSourceAction(
  sourceId: string,
  caseMarker: string,
  labels: string[],
): Promise<void> {
  const settings = await readSettings();
  const source = settings.sourceServers?.find((item) => item.sourceServerId === sourceId);
  if (!source) throw new Error(`${caseMarker}: 找不到 Source ${sourceId}`);
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 15_000 });
  await waitForTestIdByDom(TID_SETTINGS_PAGE, { timeout: 15_000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "remoteDevices"), { timeout: 15_000 });
  await browser.waitUntil(
    () =>
      browser.execute(
        (name, allowedLabels) => {
          const page = document.querySelector('[data-testid="settings-page"]');
          const cards = [
            ...new Set(
              Array.from(page?.querySelectorAll("p") ?? [])
                .filter((p) => p.textContent?.trim() === name)
                .map((p) => p.closest("section"))
                .filter((card): card is HTMLElement => card !== null),
            ),
          ];
          if (cards.length !== 1) return false;
          const button = Array.from(cards[0]!.querySelectorAll<HTMLButtonElement>("button")).find(
            (item) =>
              item.getClientRects().length &&
              !item.disabled &&
              allowedLabels.includes(item.innerText.trim()),
          );
          button?.click();
          return Boolean(button);
        },
        source.displayName,
        labels,
      ),
    {
      timeout: 30_000,
      interval: 200,
      timeoutMsg: `${caseMarker}: TargetDevice没有Available的 ${labels.join("/")} 入口`,
    },
  );
}

export async function reconnectRemoteProject(identity: string, caseMarker: string): Promise<void> {
  const before = await readRemoteTabSnapshot(identity);
  if (!before.workspacePath) throw new Error(`${caseMarker}: 找不到RetainProject路径`);
  await requestRemoteProjectConnection(identity, caseMarker);
  await waitForSSHDirectoryStep(caseMarker);
  await waitForRemoteTab({
    caseMarker,
    expectedIdentity: identity,
    expectedPath: before.workspacePath,
  });
}

export async function requestRemoteProjectConnection(
  identity: string,
  caseMarker: string,
  options: { retryFailure?: boolean } = {},
): Promise<void> {
  await selectTaskOrganizeMode(["项目", "Project"]);
  const row = $(`[data-project-workspace-identity=${JSON.stringify(identity)}]`);
  await row.waitForDisplayed({ timeout: 30_000, timeoutMsg: `${caseMarker}: Project入口未Retain` });
  await row.moveTo();
  await row.$('[data-testid="virtual-project-menu"]').click();
  await $('[data-testid="virtual-project-connect"]').click();
  if (!options.retryFailure) return;
  await browser.waitUntil(
    async () => {
      if ((await readRemoteTabSnapshot(identity)).remoteSessionId) return true;
      return browser.execute(() => {
        const button = Array.from(
          document.querySelectorAll<HTMLButtonElement>('[data-testid="ssh-dialog"] button'),
        ).find(
          (item) =>
            /^(Retry|Reconnect|Retry|Reconnect)$/iu.test(item.innerText.trim()) && !item.disabled,
        );
        button?.click();
        return Boolean(button);
      });
    },
    { timeout: 30_000, timeoutMsg: `${caseMarker}: 原地恢复没有AvailableRetry入口` },
  );
}
