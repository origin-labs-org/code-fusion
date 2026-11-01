import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_WORKSPACE } from "../../../helpers/desktop-app.js";
import {
  prepareConversationE2E,
  startNewTask,
  typeChatPrompt,
} from "../../../helpers/conversation-session.js";

// E2E case for catalog SFF01（Workspace File Search Default Filter）。
const TEST_TIMEOUT_MS = 120000;
const TID_PROMPT_SUGGESTION_PANEL = "prompt-suggestion-panel";
const TID_PROMPT_SUGGESTION_OPTION = "prompt-suggestion-option";
const TID_PROMPT_SUGGESTION_STATUS = "prompt-suggestion-status";

const createdPaths: string[] = [];

interface PanelOptionSnapshot {
  id: string | null;
  index: number;
  sectionId: string | null;
  selected: boolean;
  text: string;
}

interface PanelSnapshot {
  options: PanelOptionSnapshot[];
  statuses: Array<{ sectionId: string | null; status: string | null; text: string }>;
  trigger: string | null;
}

describe("Session area Workspace file search default filter matrix E2E", () => {
  before(async function () {
    this.timeout(TEST_TIMEOUT_MS);

    await prepareConversationE2E();
  });

  beforeEach(async function () {
    this.timeout(TEST_TIMEOUT_MS);

    await startNewTask();
  });

  after(async () => {
    await Promise.all(
      createdPaths.map((targetPath) => rm(targetPath, { recursive: true, force: true })),
    );
    await browser.electron.restoreAllMocks();
  });

  it("@ files candidate default filter: hidden directory descendants searchable, build allowed, node_modules and .env excluded", async function () {
    this.timeout(TEST_TIMEOUT_MS);

    const runId = Date.now();
    const marker = `sff-e2e-${runId}`;
    const seed = {
      envFileName: `.env.${marker}`,
      hiddenWorkflowRelPath: join(".github", "workflows", `${marker}.yml`),
      buildFileRelPath: join("build", `${marker}.txt`),
      nodeModulesFileRelPath: join("node_modules", "sff-e2e-pkg", `${marker}.js`),
    };

    await seedWorkspaceFileFilterCandidates(seed);

    await typeChatPrompt(`@${marker}.yml`);
    const hiddenPanel = await waitForPanelSections("@", ["files"], "@ file suggestion panel did not open");
    expect(optionSectionIds(hiddenPanel)).toEqual(["files"]);
    expect(optionTexts(hiddenPanel).join("\n")).toContain(`${marker}.yml`);

    await typeChatPrompt(`@${marker}.txt`);
    const buildPanel = await waitForPanelSections("@", ["files"], "@ build 文件候选面板没有打开");
    expect(optionTexts(buildPanel).join("\n")).toContain(`${marker}.txt`);

    await typeChatPrompt(`@${marker}.js`);
    await waitForPanelNoOptionContaining("sff-e2e-pkg", "node_modules files should not be candidates");

    await typeChatPrompt(`@${marker}`);
    await waitForPanelNoOptionContaining(`.env.${marker}`, ".env files should not be candidates");
  });
});

async function seedWorkspaceFileFilterCandidates(seed: {
  envFileName: string;
  hiddenWorkflowRelPath: string;
  buildFileRelPath: string;
  nodeModulesFileRelPath: string;
}) {
  const envFilePath = join(DEFAULT_WORKSPACE, seed.envFileName);
  const hiddenWorkflowPath = join(DEFAULT_WORKSPACE, seed.hiddenWorkflowRelPath);
  const buildFilePath = join(DEFAULT_WORKSPACE, seed.buildFileRelPath);
  const nodeModulesFilePath = join(DEFAULT_WORKSPACE, seed.nodeModulesFileRelPath);

  await mkdir(join(DEFAULT_WORKSPACE, ".github", "workflows"), { recursive: true });
  await mkdir(join(DEFAULT_WORKSPACE, "build"), { recursive: true });
  await mkdir(join(DEFAULT_WORKSPACE, "node_modules", "sff-e2e-pkg"), {
    recursive: true,
  });

  await writeFile(envFilePath, `MARKER=${Date.now()}\n`, "utf-8");
  await writeFile(hiddenWorkflowPath, `name: ${Date.now()}\n`, "utf-8");
  await writeFile(buildFilePath, `sff e2e build marker ${Date.now()}\n`, "utf-8");
  await writeFile(nodeModulesFilePath, `export const sffMarker = ${Date.now()};\n`, "utf-8");

  createdPaths.push(envFilePath, hiddenWorkflowPath, buildFilePath, nodeModulesFilePath);
}

async function waitForPanelSections(
  trigger: string,
  expectedSectionIds: string[],
  timeoutMsg: string,
) {
  let latest: PanelSnapshot | null = null;
  await browser.waitUntil(
    async () => {
      latest = await getPanelSnapshot();
      return (
        latest.trigger === trigger &&
        latest.options.length > 0 &&
        arraysEqual(optionSectionIds(latest), expectedSectionIds)
      );
    },
    {
      timeout: 15000,
      timeoutMsg,
    },
  );
  return latest ?? getPanelSnapshot();
}

async function waitForPanelNoOptionContaining(needle: string, timeoutMsg: string) {
  let previous: PanelSnapshot | null = null;
  let stable: PanelSnapshot | null = null;
  await browser.waitUntil(
    async () => {
      const snapshot = await getPanelSnapshot();
      const signature = panelSignature(snapshot);
      const previousSignature = previous ? panelSignature(previous) : null;
      previous = snapshot;
      if (previousSignature !== null && previousSignature === signature) {
        stable = snapshot;
        return true;
      }
      return false;
    },
    {
      timeout: 10000,
      timeoutMsg: `${timeoutMsg}（候选面板持续抖动，无法Triage稳定Final state）`,
    },
  );
  const finalSnapshot = stable ?? previous ?? (await getPanelSnapshot());
  const finalTexts = finalSnapshot.options
    .filter((option) => option.sectionId === "files")
    .map((option) => option.text);
  if (finalTexts.some((text) => text.includes(needle))) {
    throw new Error(
      `${timeoutMsg}（needle="${needle}"，实际 files 候选：${JSON.stringify(finalTexts)}）`,
    );
  }
}

function panelSignature(snapshot: PanelSnapshot): string {
  const filesStatuses = snapshot.statuses
    .filter((entry) => entry.sectionId === "files")
    .map((entry) => `${entry.status ?? "?"}:${entry.text}`)
    .join("|");
  const filesOptions = snapshot.options
    .filter((option) => option.sectionId === "files")
    .map((option) => option.text)
    .join("|");
  return `trigger=${snapshot.trigger ?? "?"};filesStatus=${filesStatuses};filesOptions=${filesOptions}`;
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getPanelSnapshot(): Promise<PanelSnapshot> {
  return browser.execute(
    (panelTestId, optionPrefix, statusPrefix) => {
      const panel = document.querySelector<HTMLElement>(`[data-testid="${panelTestId}"]`);
      const options = Array.from(
        panel?.querySelectorAll<HTMLElement>(`[data-testid^="${optionPrefix}-"]`) ?? [],
      ).map((element) => ({
        id: element.getAttribute("data-option-id"),
        index: Number(element.getAttribute("data-option-index") ?? "0"),
        sectionId: element.getAttribute("data-section-id"),
        selected: element.getAttribute("data-selected") === "true",
        text: (element.innerText || element.textContent || "").replace(/\u00a0/g, " ").trim(),
      }));
      const statuses = Array.from(
        panel?.querySelectorAll<HTMLElement>(`[data-testid^="${statusPrefix}-"]`) ?? [],
      ).map((element) => ({
        sectionId: element.getAttribute("data-section-id"),
        status: element.getAttribute("data-status"),
        text: (element.innerText || element.textContent || "").replace(/\u00a0/g, " ").trim(),
      }));
      return {
        options,
        statuses,
        trigger: panel?.getAttribute("data-trigger") ?? null,
      };
    },
    TID_PROMPT_SUGGESTION_PANEL,
    TID_PROMPT_SUGGESTION_OPTION,
    TID_PROMPT_SUGGESTION_STATUS,
  );
}

function optionSectionIds(snapshot: PanelSnapshot) {
  return [
    ...new Set(
      snapshot.options
        .map((item) => item.sectionId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function optionTexts(snapshot: PanelSnapshot) {
  return snapshot.options.map((option) => option.text);
}
