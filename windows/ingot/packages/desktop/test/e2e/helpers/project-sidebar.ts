import { basename as posixBasename } from "node:path/posix";
import { basename as win32Basename } from "node:path/win32";
import {
  TID_COMPOSER_WORKSPACE_TRIGGER,
  TID_TASK_ITEM,
  TID_V4_COMPOSER_INPUT,
  TID_V4_SESSION_PANE,
  TID_VIRTUAL_PROJECT_CREATE_TASK,
  TID_VIRTUAL_PROJECT_FILES,
  TID_VIRTUAL_PROJECT_MENU,
  TID_VIRTUAL_PROJECT_ROW,
  TID_VIRTUAL_PROJECT_TOGGLE,
  TID_WORKSPACE_FILE_TREE_PANEL,
  testId,
  virtualProjectActionTestId,
} from "@origin-ai/cf-shared/test-ids";

export async function startProjectPointerDrag(selector: string) {
  await browser.releaseActions();
  const position = await browser.execute((query) => {
    const rect = document.querySelector(query)!.getBoundingClientRect();
    return {
      x: Math.round(rect.left + 14),
      y: Math.round(rect.top + rect.height / 2),
      top: rect.top,
    };
  }, selector);
  await browser.performActions([
    {
      type: "pointer",
      id: "project-drag",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", x: position.x, y: position.y, duration: 0 },
        { type: "pointerDown", button: 0 },
        { type: "pointerMove", x: position.x, y: position.y + 8, duration: 0 },
      ],
    },
  ]);
  await browser.waitUntil(async () => (await $(selector).getAttribute("aria-pressed")) === "true", {
    timeout: 5000,
    timeoutMsg: "项目拖拽未激活",
  });
  await browser.performActions([
    {
      type: "pointer",
      id: "project-drag",
      parameters: { pointerType: "mouse" },
      actions: [{ type: "pointerMove", x: position.x, y: position.y + 24, duration: 0 }],
    },
  ]);
  return position;
}

export function projectNameForWorkspace(workspacePath: string): string {
  return (
    (workspacePath.includes("\\") ? win32Basename(workspacePath) : posixBasename(workspacePath)) ||
    workspacePath
  );
}

export function projectSectionSelector(workspacePath: string): string {
  return `[data-project-id][data-project-name=${JSON.stringify(projectNameForWorkspace(workspacePath))}]`;
}

export function projectRowSelector(workspacePath: string): string {
  return `${projectSectionSelector(workspacePath)} [data-testid="${TID_VIRTUAL_PROJECT_ROW}"]`;
}

interface WaitOptions {
  timeout?: number;
  timeoutMsg?: string;
}

async function projectRowExists(workspacePath: string): Promise<boolean> {
  try {
    return await browser.execute(
      (selector) => Boolean(document.querySelector(selector)),
      projectRowSelector(workspacePath),
    );
  } catch {
    return false;
  }
}

export async function waitForProjectRow(
  workspacePath: string,
  { timeout = 30_000, timeoutMsg = `Sidebar没有ShowProject: ${workspacePath}` }: WaitOptions = {},
): Promise<void> {
  await browser.waitUntil(() => projectRowExists(workspacePath), {
    timeout,
    interval: 100,
    timeoutMsg,
  });
}

export async function waitForProjectRowGone(
  workspacePath: string,
  { timeout = 30_000, timeoutMsg = `Project移除后仍在Sidebar: ${workspacePath}` }: WaitOptions = {},
): Promise<void> {
  await browser.waitUntil(async () => !(await projectRowExists(workspacePath)), {
    timeout,
    interval: 100,
    timeoutMsg,
  });
}

export async function waitForRestoredProjects(
  workspacePaths: string[],
  timeout = 30_000,
): Promise<void> {
  await browser.waitUntil(
    async () => {
      for (const workspacePath of workspacePaths) {
        if (!(await projectRowExists(workspacePath))) return false;
      }
      return true;
    },
    {
      timeout,
      interval: 250,
      timeoutMsg: `${workspacePaths.length} 个恢复 workspace 没有All出现在ProjectSidebar`,
    },
  );
}

async function readProjectExpanded(workspacePath: string): Promise<boolean> {
  return browser.execute(
    (selector, toggleTestId) =>
      document
        .querySelector(selector)
        ?.querySelector(`[data-testid="${toggleTestId}"]`)
        ?.getAttribute("aria-expanded") === "true",
    projectSectionSelector(workspacePath),
    TID_VIRTUAL_PROJECT_TOGGLE,
  );
}

export async function ensureProjectExpanded(
  workspacePath: string,
  timeout = 30_000,
): Promise<void> {
  await waitForProjectRow(workspacePath, { timeout });
  if (!(await readProjectExpanded(workspacePath))) {
    await clickProjectAction(workspacePath, TID_VIRTUAL_PROJECT_TOGGLE, {
      timeout: 15_000,
      timeoutMsg: `SidebarProject不可展开: ${workspacePath}`,
    });
  }
  await browser.waitUntil(() => readProjectExpanded(workspacePath), {
    timeout: 15_000,
    timeoutMsg: `SidebarProject没有Completed展开: ${workspacePath}`,
  });
}

export async function hoverProjectRow(workspacePath: string, timeout = 15_000): Promise<void> {
  const row = $(projectRowSelector(workspacePath));
  await row.waitForDisplayed({ timeout, timeoutMsg: `Sidebar没有可悬停的Project行: ${workspacePath}` });
  await row.moveTo();
}

export async function clickProjectAction(
  workspacePath: string,
  actionTestId: string,
  {
    timeout = 15_000,
    timeoutMsg = `Project ${workspacePath} 没有可点击的 ${actionTestId}`,
  }: WaitOptions = {},
): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (selector, targetTestId) => {
          const target = document
            .querySelector(selector)
            ?.querySelector<HTMLButtonElement>(`[data-testid="${targetTestId}"]`);
          if (!target || target.disabled) return false;
          target.click();
          return true;
        },
        projectSectionSelector(workspacePath),
        actionTestId,
      ),
    { timeout, interval: 100, timeoutMsg },
  );
}

export async function openProjectFileTree(
  workspacePath: string,
  { timeout = 15_000, timeoutMsg = "没有找到项目文件树入口" }: WaitOptions = {},
): Promise<void> {
  await hoverProjectRow(workspacePath, timeout);
  await clickProjectAction(workspacePath, TID_VIRTUAL_PROJECT_FILES, { timeout, timeoutMsg });
  await browser.waitUntil(
    () =>
      browser.execute(
        (panelTestId) => Boolean(document.querySelector(`[data-testid="${panelTestId}"]`)),
        TID_WORKSPACE_FILE_TREE_PANEL,
      ),
    { timeout, timeoutMsg: "File tree panel was not opened" },
  );
}

export async function startDraftFromProject(
  workspacePath: string,
  options: { workspaceIdentity?: string } = {},
): Promise<void> {
  const draftKey = options.workspaceIdentity?.trim() || workspacePath;
  const previousDraftVersion = await browser.execute((key) => {
    const bridge = (
      window as unknown as {
        __cfSessionStoreE2E?: {
          getState(): { workspaces: Record<string, { draftFocusVersion?: number }> };
        };
      }
    ).__cfSessionStoreE2E;
    return bridge?.getState().workspaces[key]?.draftFocusVersion ?? 0;
  }, draftKey);
  if (options.workspaceIdentity) {
    const project = $(
      `[data-project-workspace-identity=${JSON.stringify(options.workspaceIdentity)}]`,
    );
    await project.waitForDisplayed({ timeout: 30_000 });
    await project.moveTo();
    await project.$(`[data-testid="${TID_VIRTUAL_PROJECT_CREATE_TASK}"]`).click();
  } else {
    await hoverProjectRow(workspacePath);
    await clickProjectAction(workspacePath, TID_VIRTUAL_PROJECT_CREATE_TASK, {
      timeoutMsg: `Project ${workspacePath} 没有Available的New Task入口`,
    });
  }
  await browser.waitUntil(
    () =>
      browser.execute(
        (inputId, panePrefix, workspaceTriggerId, projectName, identity, key, previousVersion) => {
          const inputs = document.querySelectorAll(`[data-testid="${panePrefix}-workspace-main"] [data-testid="${inputId}"]`);
          const pane = inputs[0]?.closest<HTMLElement>(`[data-testid^="${panePrefix}-"]`);
          const trigger = document.querySelector<HTMLElement>(
            `[data-testid="${workspaceTriggerId}"]`,
          );
          const activeIdentity = identity
            ? (
                window as Window & {
                  __cfTabStoreE2E?: {
                    getState(): { activeWorkspaceIdentity?: string | null };
                  };
                }
              ).__cfTabStoreE2E?.getState().activeWorkspaceIdentity
            : undefined;
          return (
            ((
              window as unknown as {
                __cfSessionStoreE2E?: {
                  getState(): { workspaces: Record<string, { draftFocusVersion?: number }> };
                };
              }
            ).__cfSessionStoreE2E?.getState().workspaces[key]?.draftFocusVersion ?? 0) >
              previousVersion &&
            (!identity || activeIdentity === identity) &&
            inputs.length === 1 &&
            pane?.dataset.sessionId === "draft" &&
            trigger?.innerText.trim() === projectName
          );
        },
        TID_V4_COMPOSER_INPUT,
        TID_V4_SESSION_PANE,
        TID_COMPOSER_WORKSPACE_TRIGGER,
        projectNameForWorkspace(workspacePath),
        options.workspaceIdentity,
        draftKey,
        previousDraftVersion,
      ),
    { timeout: 30_000, timeoutMsg: `Project ${workspacePath} 的NewTaskInput框尚未就绪` },
  );
}

export async function openProjectMenuAction(
  workspacePath: string,
  actionId: string,
  { timeout = 30_000 }: WaitOptions = {},
): Promise<void> {
  await hoverProjectRow(workspacePath, timeout);
  await browser.waitUntil(
    () =>
      browser.execute(
        (selector, menuTestId) => {
          const trigger = document
            .querySelector(selector)
            ?.querySelector<HTMLButtonElement>(`[data-testid="${menuTestId}"]`);
          if (!trigger || trigger.disabled) return false;
          trigger.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              cancelable: true,
              button: 0,
              pointerId: 1,
              pointerType: "mouse",
            }),
          );
          trigger.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
          );
          trigger.click();
          return true;
        },
        projectSectionSelector(workspacePath),
        TID_VIRTUAL_PROJECT_MENU,
      ),
    { timeout, timeoutMsg: `Project ${workspacePath} 没有Show more菜单入口` },
  );
  const itemTestId = virtualProjectActionTestId(actionId);
  await browser.waitUntil(
    () =>
      browser.execute((targetTestId) => {
        const item = document.querySelector<HTMLElement>(`[data-testid="${targetTestId}"]`);
        if (!item || item.getAttribute("aria-disabled") === "true") return false;
        item.click();
        return true;
      }, itemTestId),
    { timeout: 15_000, timeoutMsg: `Project ${workspacePath} 菜单没有 ${actionId} 动作` },
  );
}

export interface ProjectTaskRowState {
  active: boolean;
  error: boolean;
  exists: boolean;
  inProject: boolean;
  running: boolean;
}

export async function readProjectTaskRowState(
  taskId: string,
  workspacePath: string,
): Promise<ProjectTaskRowState> {
  return browser.execute(
    (taskTestId, sectionSelector) => {
      const taskRow = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
        (element) => element.dataset.testid === taskTestId,
      );
      const section = document.querySelector(sectionSelector);
      return {
        active: taskRow?.classList.contains("bg-selected") ?? false,
        error: Boolean(taskRow?.querySelector('[data-error-indicator="true"]')),
        exists: Boolean(taskRow),
        inProject: Boolean(taskRow && section?.contains(taskRow)),
        running: Boolean(taskRow?.querySelector(".animate-spin")),
      };
    },
    testId(TID_TASK_ITEM, taskId),
    projectSectionSelector(workspacePath),
  );
}

export async function waitForTaskRowInProject(
  taskId: string,
  workspacePath: string,
  {
    timeout = 30_000,
    timeoutMsg = `task ${taskId} 没有出现在Project ${workspacePath} 下`,
  }: WaitOptions = {},
): Promise<void> {
  await waitForProjectRow(workspacePath, { timeout });
  await browser.waitUntil(
    async () => {
      if (!(await readProjectExpanded(workspacePath))) {
        await browser.execute(
          (selector, toggleTestId) => {
            const toggle = document
              .querySelector(selector)
              ?.querySelector<HTMLButtonElement>(`[data-testid="${toggleTestId}"]`);
            if (toggle && !toggle.disabled) toggle.click();
          },
          projectSectionSelector(workspacePath),
          TID_VIRTUAL_PROJECT_TOGGLE,
        );
      }
      const state = await readProjectTaskRowState(taskId, workspacePath);
      return state.exists && state.inProject && !state.error;
    },
    { timeout, interval: 250, timeoutMsg },
  );
}

export async function readRemoteHostIdForProject(workspacePath: string): Promise<string | null> {
  return browser.execute(
    (selector) => document.querySelector(selector)?.getAttribute("data-project-host") ?? null,
    projectSectionSelector(workspacePath),
  );
}

export async function clickRemoteHostConnect(
  workspacePath: string,
  options: WaitOptions = {},
): Promise<void> {
  await openProjectMenuAction(workspacePath, "connect", options);
}

export async function selectNativeProjectDirectories(paths: string[]) {
  const picker = await browser.electron.mock("dialog", "showOpenDialog");
  try {
    await picker.mockResolvedValueOnce({ canceled: paths.length === 0, filePaths: paths });
    await $('[data-testid="virtual-project-browse"]').click();
    await expect(picker).toHaveBeenCalledWith({
      properties: ["openDirectory", "createDirectory", "multiSelections"],
    });
    await $('[data-testid="virtual-project-save"]').waitForEnabled();
    expect(await $('[data-testid="virtual-project-directory-browser"]').isExisting()).toBe(false);
    for (const path of paths) {
      await $(
        `[data-testid="virtual-project-root-name"][title=${JSON.stringify(path)}]`,
      ).waitForDisplayed();
    }
  } finally {
    await picker.mockRestore();
  }
}

export async function selectRemoteProjectDirectory(path: string) {
  if (!(await $('[data-testid="virtual-project-directory-browser"]').isDisplayed()))
    await $('[data-testid="virtual-project-browse"]').click();
  const picker = $('[data-testid="virtual-project-directory-browser"]');
  const input = picker.$('input[type="text"]');
  await input.waitForDisplayed();
  await browser.waitUntil(async () => Boolean(await input.getValue()));
  await browser.execute((value) => {
    const element = document.querySelector<HTMLInputElement>(
      '[data-testid="virtual-project-directory-browser"] input[type="text"]',
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, path);
  await input.click();
  await browser.keys("Enter");
  const select = picker.$(
    './/button[normalize-space(.)="选择文件夹" or normalize-space(.)="Choose folder"]',
  );
  await select.waitForEnabled();
  await select.click();
  await picker.waitForExist({ reverse: true });
  await $(
    `[data-testid="virtual-project-root-name"][title=${JSON.stringify(path)}]`,
  ).waitForDisplayed();
}
