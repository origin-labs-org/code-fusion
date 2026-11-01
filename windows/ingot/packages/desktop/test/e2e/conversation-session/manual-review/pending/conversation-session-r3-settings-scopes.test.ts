import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseRemoteWorkspaceIdentity, encodeCustomModelValue } from "@origin-ai/cf-shared";
import {
  TID_CHAT_MODEL_SELECT_GROUP,
  TID_CHAT_MODEL_SELECT_ITEM,
  TID_CHAT_MODEL_SELECT_TRIGGER,
  TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM,
  TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_SUBAGENT_ROW,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { access } from "node:fs/promises";
import {
  clearAppData,
  clickTestIdByDom,
  DEFAULT_WORKSPACE,
  waitForTestIdByDom,
} from "../../../helpers/desktop-app.js";
import { resolveE2EStorageRoot } from "../../../helpers/e2e-runtime-paths.js";
import {
  createSSHLifecycleProvider,
  SSH_LIFECYCLE_MODEL_ID,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  clickLastEnabledSSHDialogButton,
  fillSSHPasswordSettings,
  openSSHRemoteDialog,
  openSSHSourceDirectory,
  readHostProcesses,
  readSSHRuntimeConfig,
  prepareSSHConnectionPage,
  runSSHCommand,
  selectSSHRemoteDirectory,
  waitForRemoteTab,
  completeSSHProjectConnection,
  waitForSSHDirectoryStep,
} from "../../../helpers/ssh-remote-p0.js";
import { prepareV4ConversationE2E, startNewV4Draft } from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_SETTINGS_SCOPES";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-settings-scopes",
);
const AGENT_NAME = "r3-remote-conversation-agent";
const AGENT_NAME_PROJECT = "r3-remote-project-agent";
const SUBAGENT_FORM_SELECTOR = `form:has(input[type="text"]):has([data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"])`;
const SECTIONS = ["skill", "mcp", "plugin", "hooks", "subagents", "memory", "general"] as const;

async function openSettingsSection(section: string): Promise<void> {
  const onSettings = await browser.execute(
    (pageId) => Boolean(document.querySelector(`[data-testid="${pageId}"]`)),
    TID_SETTINGS_PAGE,
  );
  if (!onSettings) {
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: No entry point set.`,
    });
    await waitForTestIdByDom(TID_SETTINGS_PAGE, {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: Settings page did not render`,
    });
  }
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, section), {
    timeout: 15_000,
    timeoutMsg: `${CASE_MARKER}: Settings页没有 ${section} 分区`,
  });
  const scopedSection = ["skill", "mcp", "plugin", "hooks", "subagents"].includes(section);
  await browser.waitUntil(
    async () => (await $('[data-plugin-scope-trigger="true"]').isExisting()) === scopedSection,
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: ${section} 分区的 scope 入口未就绪` },
  );
}

async function readScopeOptions(): Promise<{ current: string; options: string[] } | null> {
  const trigger = $('[data-plugin-scope-trigger="true"]');
  if (!(await trigger.isExisting())) return null;
  const current = (await trigger.getText()).trim();
  await trigger.click();
  let options: string[] = [];
  await browser.waitUntil(
      async () => {
        options = await browser.execute(() =>
          Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).map((item) =>
            item.innerText.trim(),
          ),
        );
        return options.length > 0;
      },
      { timeout: 10_000, timeoutMsg: "scope-menu" },
    );
  await browser.keys(["Escape"]);
  return { current, options };
}

async function openScopeMenu(): Promise<void> {
  const trigger = $('[data-plugin-scope-trigger="true"]');
  await trigger.waitForClickable({ timeout: 15_000 });
  await browser
    .waitUntil(
      () => browser.execute(() => document.querySelectorAll('[role="menuitemradio"]').length === 0),
      { timeout: 10_000, timeoutMsg: `${CASE_MARKER}: Old scope 菜单没有Close` },
    )
    .catch(() => undefined);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await trigger.click();
    const opened = await browser
      .waitUntil(
        () => browser.execute(() => document.querySelectorAll('[role="menuitemradio"]').length > 0),
        { timeout: 5_000, timeoutMsg: "scope-menu-open" },
      )
      .then(() => true)
      .catch(() => false);
    if (opened) return;
    await browser.pause(500);
  }
  throw new Error(`${CASE_MARKER}: scope 菜单打不开`);
}

async function selectScope(label: string): Promise<void> {
  await openScopeMenu();
  const clicked = await browser.execute((expected) => {
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find(
      (candidate) => candidate.innerText.trim().includes(expected),
    );
    if (!item) return false;
    item.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`${CASE_MARKER}: scope 菜单没有 ${label}`);
  await browser.waitUntil(
    async () => (await $('[data-plugin-scope-trigger="true"]').getText()).includes(label),
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: scope 没有切到 ${label}` },
  );
}

async function createSubagent(name: string, providerId: string, modelId: string): Promise<void> {
  const newButton = $('button[aria-label="新建"], button[aria-label="新建"]');
  await newButton.waitForClickable({ timeout: 15_000 });
  await newButton.click();
  const form = $(SUBAGENT_FORM_SELECTOR);
  await form.waitForDisplayed({ timeout: 15_000 });
  const inputs = await form.$$('input[type="text"]');
  await inputs[0]!.setValue(name);
  await inputs[1]!.setValue(`${CASE_MARKER} description`);
  await form.$("textarea").setValue(`${CASE_MARKER} system prompt for ${name}`);
  const model = encodeCustomModelValue(providerId, modelId);
  const itemTestId = testId(TID_CHAT_MODEL_SELECT_ITEM, model);
  const groupTestId = testId(TID_CHAT_MODEL_SELECT_GROUP, `registry-provider:${providerId}`);
  const trigger = form.$(`[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"]`);
  await trigger.waitForClickable({ timeout: 15_000 });
  await trigger.click();
  await browser.waitUntil(
    () =>
      browser.execute(
        (item, group) =>
          Boolean(
            document.querySelector(`[data-testid="${item}"]`) ||
            document.querySelector(`[data-testid="${group}"]`),
          ),
        itemTestId,
        groupTestId,
      ),
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: Subagent 表单Model菜单没有 ${providerId}` },
  );
  await browser.execute(
    (item, group) => {
      if (document.querySelector(`[data-testid="${item}"]`)) return;
      const node = document.querySelector<HTMLElement>(`[data-testid="${group}"]`);
      if (!node) return;
      node.focus();
      for (const eventName of ["pointerenter", "mouseenter", "mousemove"])
        node.dispatchEvent(
          new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }),
        );
      node.click();
    },
    itemTestId,
    groupTestId,
  );
  await browser.waitUntil(
    () =>
      browser.execute(
        (item) => Boolean(document.querySelector(`[data-testid="${item}"]`)),
        itemTestId,
      ),
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: Model菜单没有出现 ${model}` },
  );
  await browser.execute(
    (item) => document.querySelector<HTMLElement>(`[data-testid="${item}"]`)?.click(),
    itemTestId,
  );
  await browser.waitUntil(
    async () => (await trigger.getAttribute("data-model-current-value")) === model,
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: Model控件没有切换到 ${model}` },
  );
  let levelSelected = false;
  const levelTrigger = form.$(`[data-testid="${TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER}"]`);
  const levelTriggerClickable = await levelTrigger.waitForClickable({ timeout: 5_000 }).then(
    () => true,
    () => false,
  );
  for (let attempt = 0; attempt < 3 && levelTriggerClickable && !levelSelected; attempt += 1) {
    await levelTrigger.click();
    try {
      const item = $(`[data-testid="${testId(TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM, "disabled")}"]`);
      await item.waitForClickable({ timeout: 3_000 });
      await item.click();
      levelSelected = true;
    } catch {
      await browser.keys(["Escape"]);
    }
  }
  await browser
    .waitUntil(
      () =>
        browser.execute(
          () => !document.querySelector('[role="menu"][data-state="open"], [role="listbox"]'),
        ),
      { timeout: 5_000, timeoutMsg: "menus-closed" },
    )
    .catch(() => undefined);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const submitted = await browser.execute(
      (selector, attemptIndex) => {
        const formNode = document.querySelector<HTMLFormElement>(selector);
        if (!formNode) return "no-form";
        const button = formNode.querySelector<HTMLButtonElement>('button[type="submit"]');
        if (button?.disabled) return "disabled";
        if (attemptIndex === 0) {
          formNode.requestSubmit(button ?? undefined);
          return "requestSubmit";
        }
        button?.click();
        return "click";
      },
      SUBAGENT_FORM_SELECTOR,
      attempt,
    );
    void submitted;
    const closed = await browser
      .waitUntil(async () => !(await $(SUBAGENT_FORM_SELECTOR).isExisting()), {
        timeout: 20_000,
        timeoutMsg: "form-close",
      })
      .then(() => true)
      .catch(() => false);
    if (closed) break;
  }
  await browser
    .waitUntil(async () => !(await $(SUBAGENT_FORM_SELECTOR).isExisting()), {
      timeout: 5_000,
      timeoutMsg: `${CASE_MARKER}: Subagent Save后表单没有Close`,
    })
    .catch(async (error) => {
      const diagnostics = await browser.execute((selector) => {
        const formNode = document.querySelector<HTMLElement>(selector);
        const alerts = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="alert"], [role="status"], [data-sonner-toast]',
          ),
        )
          .map((n) => (n.innerText ?? "").trim())
          .filter(Boolean);
        return {
          formText: (formNode?.innerText ?? "").replace(/\s+/gu, " ").slice(0, 600),
          alerts: alerts.slice(0, 5),
          submitDisabled:
            formNode?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled ?? null,
        };
      }, SUBAGENT_FORM_SELECTOR);
      throw new Error(`${String(error)}; diagnostics=${JSON.stringify(diagnostics)}`);
    });
  await waitForTestIdByDom(testId(TID_SUBAGENT_ROW, name), {
    timeout: 15_000,
    timeoutMsg: `${CASE_MARKER}: Subagent 行没有出现: ${name}`,
  });
}

async function selectScopeKey(key: string): Promise<void> {
  await openScopeMenu();
  const clicked = await browser.execute((expectedKey) => {
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ).find((item) => item.dataset.pluginScopeKey === expectedKey);
    option?.click();
    return Boolean(option);
  }, key);
  expect(clicked).toBe(true);
  await browser.waitUntil(
    async () =>
      (await $('[data-plugin-scope-trigger="true"]').getAttribute("data-plugin-scope-key")) === key,
    { timeout: 15_000, timeoutMsg: CASE_MARKER + ": scope identity 未切换" },
  );
}

async function localFileExists(path: string, waitMs = 0): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      await access(path);
      return true;
    } catch {
      if (Date.now() >= deadline) return false;
      await browser.pause(500);
    }
  }
}

describe(`${CASE_MARKER}: 远端 Source Online时Settings scope 与Sub-agent落盘Location`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "settings-scopes.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-DEV-06 When remote project B is active, User new creations only persist locally; project A/B scopes persist to disk separately by identity", async function () {
    this.timeout(30 * 60_000);
    const config = readSSHRuntimeConfig(CASE_MARKER);
    const [workspaceA, workspaceB] = config.workspacePaths;
    await prepareSSHConnectionPage(CASE_MARKER);
    await prepareV4ConversationE2E({ skipProvider: true });
    const initialHosts = await readHostProcesses();
    provider = await createSSHLifecycleProvider(config, CASE_MARKER, { tunnelUsername: "tunnel" });
    await runSSHCommand(
      config,
      `rm -f "$HOME/.cf/agents/${AGENT_NAME}.md" "${workspaceA}/.cf/agents/${AGENT_NAME_PROJECT}.md"`,
    );

    await startNewV4Draft();
    await openSSHRemoteDialog(CASE_MARKER);
    await fillSSHPasswordSettings(config);
    await clickLastEnabledSSHDialogButton(CASE_MARKER);
    const conversation = await completeSSHProjectConnection(
      { ...config, workspacePaths: [workspaceB, workspaceA] },
      CASE_MARKER,
    );
    const sourceId =
      parseRemoteWorkspaceIdentity(conversation.workspaceIdentity!)?.sourceServerId ?? "";
    expect(sourceId).toBeTruthy();

    const scopesProjectB: Record<string, unknown> = {};
    for (const section of SECTIONS) {
      await openSettingsSection(section);
      const scopes = await readScopeOptions();
      scopesProjectB[section] = scopes;
      if (["memory", "general"].includes(section)) {
        expect(scopes).toBeNull();
      } else {
        expect(scopes?.options).toEqual(
          expect.arrayContaining([
            expect.stringContaining("用户 · "),
            expect.stringContaining(basename(workspaceB)),
          ]),
        );
        expect(scopes?.options).not.toContain(basename(workspaceA));
      }
    }
    facts.scopeOptionsForProjectB = scopesProjectB;

    await openSettingsSection("subagents");
    await waitForTestIdByDom(testId(TID_SUBAGENT_ROW, "general-purpose"), { timeout: 30_000 });
    const subagentScopes = await readScopeOptions();
    facts.subagentScopesForProjectB = subagentScopes;
    await selectScope("用户");
    const localControlName = "r3-local-user-agent";
    await createSubagent(localControlName, provider.id, SSH_LIFECYCLE_MODEL_ID);
    facts.localControlFileExists = await localFileExists(
      join(resolveE2EStorageRoot(), "agents", `${localControlName}.md`),
      15_000,
    );
    expect(facts.localControlFileExists).toBe(true);

    const remoteControlFile = await runSSHCommand(
      config,
      'find "$HOME" -name "r3-local-user-agent.md" -print',
    );
    facts.remoteControlFiles = remoteControlFile.stdout.trim();
    expect(remoteControlFile.stdout.trim()).toBe("");

    await selectScopeKey(conversation.workspaceIdentity!);
    await createSubagent(AGENT_NAME, provider.id, SSH_LIFECYCLE_MODEL_ID);
    const remoteConversationFile = await runSSHCommand(
      config,
      `test -f "${conversation.workspacePath}/.cf/agents/${AGENT_NAME}.md" && echo FOUND; test ! -f "$HOME/.cf/agents/${AGENT_NAME}.md" && echo USER_UNCHANGED`,
    );
    facts.remoteConversationFile = remoteConversationFile.stdout.trim();
    expect(remoteConversationFile.stdout).toContain("FOUND");
    expect(remoteConversationFile.stdout).toContain("USER_UNCHANGED");
    expect(await localFileExists(join(resolveE2EStorageRoot(), "agents", AGENT_NAME + ".md"))).toBe(
      false,
    );
    facts.sourceUserCoverage = "Not covered: Separate acceptance for explicit Source User and conversation workspace";
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: Settings page back button did not appear`,
    });

    await openSSHSourceDirectory(config, CASE_MARKER);
    expect(await waitForSSHDirectoryStep(CASE_MARKER)).toBe("directory");
    await selectSSHRemoteDirectory(workspaceA, CASE_MARKER);
    const project = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedPath: workspaceA,
      timeoutMs: 120_000,
    });
    await openSettingsSection("subagents");
    await waitForTestIdByDom(testId(TID_SUBAGENT_ROW, "general-purpose"), { timeout: 30_000 });
    const subagentScopesWithProject = await readScopeOptions();
    facts.subagentScopesWithProject = subagentScopesWithProject;
    const projectScope =
      subagentScopesWithProject?.options.find((option) => option.includes(basename(workspaceA))) ??
      null;
    facts.projectScopeLabel = projectScope;
    expect(projectScope).toBeTruthy();
    await selectScopeKey(project.workspaceIdentity!);
    let projectScopeSaveError: string | null = null;
    await createSubagent(AGENT_NAME_PROJECT, provider.id, SSH_LIFECYCLE_MODEL_ID).catch(
      async (error) => {
        projectScopeSaveError = String(error).slice(0, 600);
        await browser.execute(() => {
          const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
            (b) => b.innerText.trim() === "取消" && b.getClientRects().length,
          );
          cancel?.click();
        });
        await browser.pause(500);
      },
    );
    facts.remoteProjectScopeSaveError = projectScopeSaveError;
    await browser.pause(3_000);
    const remoteProjectFile = await runSSHCommand(
      config,
      `test -f "${workspaceA}/.cf/agents/${AGENT_NAME_PROJECT}.md" && echo FOUND || echo MISSING; find "$HOME/.cf" "${workspaceA}" -name "${AGENT_NAME_PROJECT}.md" 2>/dev/null`,
    );
    facts.remoteProjectAgentFile = remoteProjectFile.stdout.trim().split("\n");
    facts.localProjectAgentFileExists = await localFileExists(
      join(DEFAULT_WORKSPACE, ".cf", "agents", `${AGENT_NAME_PROJECT}.md`),
    );
    facts.localStorageProjectAgentFileExists = await localFileExists(
      join(resolveE2EStorageRoot(), "agents", `${AGENT_NAME_PROJECT}.md`),
    );
    expect(facts.localProjectAgentFileExists).toBe(false);

    const scopesWithProject: Record<string, unknown> = {};
    for (const section of SECTIONS) {
      if (section === "subagents") continue;
      await openSettingsSection(section);
      const scopes = await readScopeOptions();
      scopesWithProject[section] = scopes;
      if (["memory", "general"].includes(section)) {
        expect(scopes).toBeNull();
      } else {
        expect(scopes?.options).toEqual(
          expect.arrayContaining([
            expect.stringContaining("用户 · "),
            expect.stringContaining(basename(workspaceA)),
            expect.stringContaining(basename(workspaceB)),
          ]),
        );
      }
    }
    facts.scopeOptionsWithProject = scopesWithProject;
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: Settings page back button did not appear`,
    });
    expect(await readHostProcesses()).toEqual(initialHosts);
    expect(facts.localStorageProjectAgentFileExists).toBe(false);
    expect(projectScopeSaveError).toBeNull();
    expect(remoteProjectFile.stdout).toContain("FOUND");
  });
});
