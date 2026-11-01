import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  TID_MODEL_PROVIDER_MODEL_INPUT,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData, clickTestIdByDom, DEFAULT_WORKSPACE } from "../../../helpers/desktop-app.js";
import { getUpstreamRequestRecordCount } from "../../../helpers/conversation-session-network.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import { readRemoteTabSnapshot, runSSHCommand } from "../../../helpers/ssh-remote-p0.js";
import { selectV4TaskById } from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_CONNECTIVITY_TEST";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-connectivity-test",
);

async function openModelProviderSettings(): Promise<void> {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15_000,
    timeoutMsg: `${CASE_MARKER}: No entry point set.`,
  });
  await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).waitForDisplayed({ timeout: 15_000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"), {
    timeout: 15_000,
    timeoutMsg: `${CASE_MARKER}: Settings page lacks the model provider section`,
  });
}

async function runConnectivityTest(
  providerName: string,
  modelId: string,
): Promise<{ clicked: boolean; toast: string }> {
  await browser.waitUntil(
    () =>
      browser.execute((name) => {
        const item = Array.from(
          document.querySelectorAll<HTMLElement>(
            "button, a, [role='button'], [role='treeitem'], li",
          ),
        ).find((node) => node.innerText.trim() === name && node.getClientRects().length);
        item?.click();
        return Boolean(item);
      }, providerName),
    {
      timeout: 30_000,
      interval: 300,
      timeoutMsg: `${CASE_MARKER}: Settings页没有 provider ${providerName}`,
    },
  );
  await browser.execute((provider) => {
    for (const item of document.querySelectorAll<HTMLElement>(
      "[data-provider-detail-feedback-state]",
    )) {
      if (item.innerText.includes(provider))
        item.querySelector<HTMLButtonElement>("button")?.click();
    }
  }, providerName);
  await browser.waitUntil(
    () =>
      browser.execute(
        (provider) =>
          !Array.from(
            document.querySelectorAll<HTMLElement>("[data-provider-detail-feedback-state]"),
          ).some((item) => item.innerText.includes(provider)),
        providerName,
      ),
    { timeout: 10_000, timeoutMsg: `${CASE_MARKER}: 上One次ModelTestsFeedback没有Close` },
  );
  let clicked = false;
  await browser.waitUntil(
    async () => {
      clicked = await browser.execute(
        (model, prefix) => {
          const label = Array.from(
            document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}-"]`),
          ).find((node) => node.textContent?.trim() === model && node.getClientRects().length);
          if (!label) return false;
          let row = label.parentElement;
          while (row) {
            const button = Array.from(row.querySelectorAll<HTMLButtonElement>("button")).find(
              (item) => item.title === "Test Model",
            );
            if (button) {
              if (button.disabled) return false;
              button.click();
              return true;
            }
            row = row.parentElement;
          }
          return false;
        },
        modelId,
        TID_MODEL_PROVIDER_MODEL_INPUT,
      );
      return clicked;
    },
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 找不到TargetModel ${modelId} 的Tests按钮` },
  );
  let toast = "";
  await browser.waitUntil(
    async () => {
      toast = await browser.execute(
        (provider, model) =>
          Array.from(
            document.querySelectorAll<HTMLElement>("[data-provider-detail-feedback-state]"),
          )
            .filter(
              (item) =>
                item.getClientRects().length &&
                item.dataset.providerDetailFeedbackState !== "pending" &&
                item.innerText.includes(provider) &&
                item.innerText.includes(model),
            )
            .map((item) => item.innerText.trim())
            .join(" | "),
        providerName,
        modelId,
      );
      return toast.length > 0;
    },
    {
      timeout: 60_000,
      interval: 200,
      timeoutMsg: `${CASE_MARKER}: TargetModel没有产生本次Tests的Final stateFeedback`,
    },
  );
  return { clicked, toast };
}

describe(`${CASE_MARKER}: 激活远端 workspace 时Model Settings连通性Tests的executeLocation`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "connectivity-test.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-PRV-17 Executes locally when local workspace exists (replay receives request, no remote logs); explicitly unavailable when no local tab or remembered path exists; Linux paths not passed to local Agent", async function () {
    this.timeout(25 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER, { tunnelUsername: "tunnel" });
    provider = prepared.provider;
    const [workspaceA] = prepared.config.workspacePaths;
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    await selectV4TaskById(taskA.taskId);
    const remoteLogBefore = await runSSHCommand(
      prepared.config,
      'F=$(ls -t ~/.cf/cli/log/*.jsonl | head -n1); grep -c "model.network" "$F" || true',
    );

    const requestsBefore = await getUpstreamRequestRecordCount();
    await openModelProviderSettings();
    const withLocal = await runConnectivityTest("Upstream E2E", "deepseek-v4-flash");
    await browser.pause(2_000);
    const requestsAfter = await getUpstreamRequestRecordCount();
    const remoteLogAfter = await runSSHCommand(
      prepared.config,
      'F=$(ls -t ~/.cf/cli/log/*.jsonl | head -n1); grep -c "model.network" "$F" || true',
    );
    facts.withLocalWorkspace = {
      ...withLocal,
      localReplayRequestsDelta: requestsAfter - requestsBefore,
      remoteModelNetworkDelta:
        Number.parseInt(remoteLogAfter.stdout.trim() || "0", 10) -
        Number.parseInt(remoteLogBefore.stdout.trim() || "0", 10),
    };
    expect(withLocal.clicked).toBe(true);
    expect(requestsAfter - requestsBefore).toBeGreaterThanOrEqual(1);
    expect(withLocal.toast).toMatch(/Connected successfully/u);
    expect(
      (facts.withLocalWorkspace as { remoteModelNetworkDelta: number }).remoteModelNetworkDelta,
    ).toBe(0);
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: Settings page back button did not appear`,
    });

    const closedLocal = await browser.execute((localPath) => {
      const store = (
        window as Window & {
          __cfTabStoreE2E?: {
            getState?: () => {
              tabs?: Array<{
                id: string;
                kind?: string;
                workspacePath?: string;
                workspaceIdentity?: string;
                remoteSessionId?: string;
              }>;
              closeTab?: (id: string, origin: "user-close") => void;
            };
          };
        }
      ).__cfTabStoreE2E;
      const state = store?.getState?.();
      const locals = (state?.tabs ?? []).filter(
        (tab) => tab.kind === "workspace" && !tab.workspaceIdentity && !tab.remoteSessionId,
      );
      for (const tab of locals) state?.closeTab?.(tab.id, "user-close");
      return {
        closed: locals.length,
        remaining: (store?.getState?.().tabs ?? []).map((tab) => tab.workspacePath ?? ""),
        localPath,
      };
    }, DEFAULT_WORKSPACE);
    facts.closedLocalTabs = closedLocal;
    await browser.pause(1_500);
    await selectV4TaskById(taskA.taskId);
    const routingFixture = await browser.execute((identity) => {
      type Tab = {
        id: string;
        kind: string;
        workspacePath?: string;
        workspaceIdentity?: string;
        remoteSessionId?: string;
        localWorkspacePath?: string;
      };
      const store = (
        window as Window & {
          __cfTabStoreE2E?: {
            getState(): { tabs: Tab[]; activeWorkspaceIdentity?: string | null };
            setState(patch: { tabs: Tab[] }): void;
          };
        }
      ).__cfTabStoreE2E;
      if (!store) throw new Error("Missing TabStore fixture bridge");
      const state = store.getState();
      const remote = state.tabs.find((tab) => tab.workspaceIdentity === identity);
      if (!remote || state.activeWorkspaceIdentity !== identity)
        throw new Error("Remote workspace not active");
      const localTabs = state.tabs.filter(
        (tab) => tab.kind === "workspace" && !tab.workspaceIdentity && !tab.remoteSessionId,
      );
      if (localTabs.length) throw new Error("Local workspace still exists, negative prerequisite not met");
      store.setState({
        tabs: state.tabs.map((tab) =>
          tab.workspaceIdentity === identity ? { ...tab, localWorkspacePath: undefined } : tab,
        ),
      });
      return {
        activeIdentity: identity,
        previousLocalPath: remote.localWorkspacePath ?? null,
        localTabCount: localTabs.length,
      };
    }, taskA.identity);
    facts.withoutLocalRoutingFixture = routingFixture;
    const requestsBefore2 = await getUpstreamRequestRecordCount();
    await openModelProviderSettings();
    const withoutLocal = await runConnectivityTest("Upstream E2E", "deepseek-v4-flash");
    await browser.pause(2_000);
    const requestsAfter2 = await getUpstreamRequestRecordCount();
    const remoteLogAfter2 = await runSSHCommand(
      prepared.config,
      'F=$(ls -t ~/.cf/cli/log/*.jsonl | head -n1); grep -c "model.network" "$F" || true',
    );
    facts.withoutLocalWorkspace = {
      ...withoutLocal,
      localReplayRequestsDelta: requestsAfter2 - requestsBefore2,
      remoteModelNetworkDelta:
        Number.parseInt(remoteLogAfter2.stdout.trim() || "0", 10) -
        Number.parseInt(remoteLogAfter.stdout.trim() || "0", 10),
    };
    expect(withoutLocal.toast).toMatch(/LocalWorkspaceUnavailable|Unavailable/u);
    expect(requestsAfter2 - requestsBefore2).toBe(0);
    expect(
      (facts.withoutLocalWorkspace as { remoteModelNetworkDelta: number }).remoteModelNetworkDelta,
    ).toBe(0);
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: Settings page back button did not appear`,
    });
    expect((await readRemoteTabSnapshot(taskA.identity)).remoteSessionId).toBe(
      taskA.remoteSessionId,
    );
  });
});
