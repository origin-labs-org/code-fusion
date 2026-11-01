import { formatCfAgentProcessName } from "@origin-ai/cf-shared";
import { startDraftFromProject, waitForProjectRow } from "./project-sidebar.js";
import {
  countAgentProcessRows,
  listAgentProcessIdentities,
  waitForAgentProcessCount,
  type AgentProcessIdentity,
} from "./resource-manager.js";

export function pickWorkspacePaths(workspacePaths: string[], indexes: readonly number[]): string[] {
  return indexes.map((index) => {
    const workspacePath = workspacePaths[index];
    if (!workspacePath) {
      throw new Error(`workspace fixture Missing index=${index}`);
    }
    return workspacePath;
  });
}

export async function waitForActiveWorkspacePath(
  expectedWorkspacePath: string,
  timeout = 30_000,
): Promise<void> {
  await browser.waitUntil(
    async () => {
      try {
        return await browser.execute((expectedPath) => {
          const tabStore = (
            window as Window & {
              __cfTabStoreE2E?: {
                getState?: () => { activeWorkspacePath?: string | null };
              };
            }
          ).__cfTabStoreE2E;
          return tabStore?.getState?.().activeWorkspacePath === expectedPath;
        }, expectedWorkspacePath);
      } catch {
        return false;
      }
    },
    {
      timeout,
      interval: 100,
      timeoutMsg: `active workspace 没有收敛为 ${expectedWorkspacePath}`,
    },
  );
}

export { waitForRestoredProjects } from "./project-sidebar.js";

export async function openWorkspaceDraftFromSidebar(workspacePath: string): Promise<void> {
  await waitForProjectRow(workspacePath, {
    timeout: 15_000,
    timeoutMsg: `Sidebar没有 dormant workspace 对应的Project: ${workspacePath}`,
  });
  await startDraftFromProject(workspacePath);
  await waitForActiveWorkspacePath(workspacePath);
}

export async function assertStableAgentSelection(
  allWorkspacePaths: string[],
  expectedWorkspacePaths: string[],
): Promise<AgentProcessIdentity[]> {
  await waitForAgentProcessCount(expectedWorkspacePaths.length);
  await browser.pause(1_500);

  const identities = await listAgentProcessIdentities();
  expect(identities).toHaveLength(expectedWorkspacePaths.length);

  const expected = new Set(expectedWorkspacePaths);
  const placeholderPrefix = formatCfAgentProcessName("placeholder");
  for (const workspacePath of allWorkspacePaths) {
    const formatted = formatCfAgentProcessName("placeholder", workspacePath);
    const workspaceNameSuffix = formatted.slice(placeholderPrefix.length);
    const actual = await countAgentProcessRows({ workspaceNameSuffix });
    expect(actual).toBe(expected.has(workspacePath) ? 1 : 0);
  }

  return identities;
}

export async function selectTaskOrganizeMode(_labels: string[]): Promise<void> {
  await $('[data-testid="sidebar-view-menu"]').click();
  await $('[role="menuitemradio"][data-state]') .waitForExist();
  const item = $('[role="menuitemradio"][data-testid="sidebar-view-projects"]');
  await item.click();
  await $('[data-testid="project-section"]').waitForDisplayed();
}
