import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_WORKSPACE } from "../../../helpers/desktop-app.js";
import { skipOccupationOnboardingIfPresent } from "../../../helpers/occupation-onboarding.js";
import {
  prepareConversationE2E,
  startNewTask,
  typeChatPrompt,
} from "../../../helpers/conversation-session.js";

const LINE_SEP = "\n";

const TEST_TIMEOUT_MS = 180000;
const TID_PROMPT_SUGGESTION_PANEL = "prompt-suggestion-panel";
const TID_PROMPT_SUGGESTION_OPTION = "prompt-suggestion-option";
const TID_PROMPT_SUGGESTION_STATUS = "prompt-suggestion-status";

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

let seededDirs: string[] = [];
let createdCfIgnore = false;
let originalGitignore: string | null = null;

describe("Session area .cfignore workspace search ignore rules E2E", () => {
  before(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await skipOccupationOnboardingIfPresent();
    await prepareConversationE2E();
  });

  beforeEach(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await startNewTask();
  });

  after(async () => {
    await Promise.all(seededDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    seededDirs = [];
    if (createdCfIgnore) {
      await rm(join(DEFAULT_WORKSPACE, ".cfignore"), { force: true });
      createdCfIgnore = false;
    }
    const gitignorePath = join(DEFAULT_WORKSPACE, ".gitignore");
    if (originalGitignore === null) {
      await rm(gitignorePath, { force: true });
    } else {
      await writeFile(gitignorePath, originalGitignore, "utf-8");
    }
    originalGitignore = null;
    await browser.electron.restoreAllMocks();
  });

  it("@ prunes via in-memory rules without creating .cfignore; manual rule files remain effective", async function () {
    this.timeout(TEST_TIMEOUT_MS);

    const runId = Date.now();
    const marker = `zci-e2e-${runId}`;
    const objFileRelPath = join("obj", "Debug", `${marker}.cs`);
    const srcFileRelPath = join("src", `${marker}.ts`);

    const gitignorePath = join(DEFAULT_WORKSPACE, ".gitignore");
    originalGitignore = await readFile(gitignorePath, "utf-8").catch(() => null);
    const baseGitignore = originalGitignore ?? "";
    if (!/^obj\/$/m.test(baseGitignore)) {
      await writeFile(gitignorePath, `${baseGitignore}${baseGitignore.endsWith("\n") || !baseGitignore ? "" : "\n"}obj/\n`, "utf-8");
    }
    const objDir = join(DEFAULT_WORKSPACE, "obj");
    const srcDir = join(DEFAULT_WORKSPACE, "src");
    await mkdir(join(objDir, "Debug"), { recursive: true });
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(DEFAULT_WORKSPACE, objFileRelPath), `// ${marker}\n`, "utf-8");
    await writeFile(join(DEFAULT_WORKSPACE, srcFileRelPath), `// ${marker}\n`, "utf-8");
    seededDirs.push(objDir, srcDir);

    await typeChatPrompt(`@${marker}`);
    const visiblePanel = await waitForPanelSections("@", ["files"], "@ file suggestion panel did not open");
    expect(visiblePanel.options.map((o) => o.text).join("\n")).toContain(`${marker}.ts`);
    await typeChatPrompt(`@${marker}.cs`);
    await waitForPanelNoOptionContaining("obj/Debug", "Ignored files under obj/ should not be candidates");

    const cfIgnorePath = join(DEFAULT_WORKSPACE, ".cfignore");
    await expect(stat(cfIgnorePath)).rejects.toMatchObject({ code: "ENOENT" });

    await writeFile(cfIgnorePath, ["# emptied by e2e", ""].join(LINE_SEP), "utf-8");
    createdCfIgnore = true;

    await typeChatPrompt("refresh-panel");
    await typeChatPrompt(`@${marker}.cs`);
    await waitForPanelFilesOptionContaining(
      `${marker}.cs`,
      "Files under obj/Debug were not restored to searchable after deleting rules",
    );
  });
});

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
    { timeout: 15000, timeoutMsg },
  );
  return latest ?? getPanelSnapshot();
}

function optionSectionIds(snapshot: PanelSnapshot): string[] {
  return Array.from(new Set(snapshot.options.map((option) => option.sectionId ?? "?")));
}

async function waitForPanelFilesOptionContaining(needle: string, timeoutMsg: string) {
  await browser.waitUntil(
    async () => {
      const snapshot = await getPanelSnapshot();
      if (snapshot.trigger !== "@") {
        return false;
      }
      return snapshot.options
        .filter((option) => option.sectionId === "files")
        .some((option) => option.text.includes(needle));
    },
    { timeout: 15000, timeoutMsg },
  );
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
    { timeout: 15000, timeoutMsg: `${timeoutMsg}（候选面板持续抖动，无法Triage稳定Final state）` },
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
