import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CF_AGENT_PROVIDER } from "@origin-ai/cf-shared";
import { TID_V4_COMPOSER_INPUT } from "@origin-ai/cf-shared/test-ids";
import { DEFAULT_WORKSPACE } from "../../../helpers/desktop-app.js";
import {
  prepareConversationE2E,
  startNewTask,
} from "../../../helpers/conversation-session.js";

const TEST_TIMEOUT_MS = 120000;
const TID_PROMPT_SUGGESTION_PANEL = "prompt-suggestion-panel";
const TID_PROMPT_SUGGESTION_OPTION = "prompt-suggestion-option";
const TID_PROMPT_SUGGESTION_STATUS = "prompt-suggestion-status";
const createdWorkspacePaths: string[] = [];

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

describe("Session Area Composer Prefix Prompt Routing E2E", () => {
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
      createdWorkspacePaths.map((targetPath) =>
        rm(targetPath, { recursive: true, force: true }),
      ),
    );
    await browser.electron.restoreAllMocks();
  });

  it("@ aggregates plugin/file/session/whiteboard, / suggests command/skill/subagent, $ retains compatibility panel, and keyboard selection inserts correct mention", async function () {
    this.timeout(TEST_TIMEOUT_MS);

    const runId = Date.now();
    const seed = {
      commandName: `e2e-cmd-${runId}`,
      directoryName: `e2e-route-dir-${runId}`,
      fileName: `e2e-route-file-${runId}.ts`,
      skillName: `e2e-skill-${runId}`,
      subagentName: `e2e-agent-${runId}`,
      whiteboardName: `e2e-route-board-${runId}`,
    };

    await seedWorkspaceFileCandidates(seed);
    await seedRendererPromptSources(seed);

    await setComposerText(`@${seed.fileName}`);
    const atFilePanel = await waitForPanelSections("@", ["files"], "@ file suggestion panel did not open");
    expect(optionTexts(atFilePanel).join("\n")).toContain(seed.fileName);
    assertPanelExcludesSections(atFilePanel, ["commands", "subagents", "skills"]);
    await browser.keys("Enter");
    await waitForComposerMarkdownContaining(
      seed.fileName,
      "File mention markdown was not inserted after pressing Enter on @ file suggestion",
    );

    await setComposerText(`@${seed.directoryName}`);
    const atDirectoryPanel = await waitForPanelSections("@", ["files"], "@ folder suggestion panel did not open");
    expect(optionTexts(atDirectoryPanel).join("\n")).toContain(seed.directoryName);
    await browser.keys("Tab");
    await waitForComposerMarkdownContaining(
      `${seed.directoryName}/`,
      "Directory mention markdown was not inserted after pressing Tab on @ folder suggestion",
    );

    await setComposerText(`@${seed.whiteboardName}`);
    const atWhiteboardPanel = await waitForPanelSections("@", ["whiteboards"], "@ whiteboard suggestion panel did not open");
    expect(optionTexts(atWhiteboardPanel).join("\n")).toContain(seed.whiteboardName);
    assertPanelExcludesSections(atWhiteboardPanel, ["commands", "subagents", "skills"]);

    await setComposerText("@skill-creator");
    const atPluginPanel = await waitForPanelSections("@", ["plugins"], "@ plugin suggestion panel did not open");
    expect(optionTexts(atPluginPanel).join("\n")).toContain("skill-creator");
    assertPanelExcludesSections(atPluginPanel, ["commands", "subagents", "skills"]);
    await browser.keys("Enter");
    await waitForComposerMarkdownContaining(
      "plugin://skill-creator@cf-plugins-official",
      "Canonical plugin mention markdown was not inserted after pressing Enter on @ plugin suggestion",
    );

    await setComposerText("/");
    const slashPanel = await waitForPanelSections("/", ["commands", "skills", "subagents"], "/ suggestion panel did not open");
    assertPanelExcludesSections(slashPanel, ["files", "whiteboards"]);

    await setComposerText(`/${seed.commandName}`);
    const slashCommandPanel = await waitForPanelSections("/", ["commands"], "/ command suggestion panel did not open");
    expect(optionTexts(slashCommandPanel).join("\n")).toContain(`/${seed.commandName}`);
    await browser.keys("Enter");
    await waitForComposerMarkdown(
      `/${seed.commandName}`,
      "Slash command mention markdown was not inserted after pressing Enter on / command suggestion",
    );

    await setComposerText(`/${seed.skillName}`);
    const slashSkillPanel = await waitForPanelSections("/", ["skills"], "/ skill suggestion panel did not open");
    expect(optionTexts(slashSkillPanel).join("\n")).toContain(`$${seed.skillName}`);
    await browser.keys("Enter");
    await waitForComposerMarkdownContaining(
      `$${seed.skillName}`,
      "Skill mention markdown was not inserted after pressing Enter on / skill suggestion",
    );

    await setComposerText(`/${seed.subagentName}`);
    const slashSubagentPanel = await waitForPanelSections("/", ["subagents"], "/ subagent suggestion panel did not open");
    expect(optionTexts(slashSubagentPanel).join("\n")).toContain(seed.subagentName);
    await browser.keys("Tab");
    await waitForComposerMarkdown(
      `@${seed.subagentName}`,
      "Subagent mention markdown was not inserted after pressing Tab on / subagent suggestion",
    );

    await setComposerText(`$${seed.skillName}`);
    const skillPanel = await waitForPanelSections("$", ["skills"], "$ skill suggestion panel did not open");
    expect(optionTexts(skillPanel).join("\n")).toContain(seed.skillName);
    assertPanelExcludesSections(skillPanel, ["files", "whiteboards", "commands", "subagents"]);
    await browser.keys("Enter");
    await waitForComposerMarkdownContaining(
      `$${seed.skillName}`,
      "Skill mention markdown was not inserted after pressing Enter on $ skill suggestion",
    );
  });
});

async function seedWorkspaceFileCandidates(seed: {
  directoryName: string;
  fileName: string;
}) {
  const directoryPath = join(DEFAULT_WORKSPACE, seed.directoryName);
  const filePath = join(DEFAULT_WORKSPACE, seed.fileName);
  await mkdir(directoryPath, { recursive: true });
  await writeFile(
    filePath,
    "export const e2eComposerPrefixRouting = true;\n",
    "utf-8",
  );
  createdWorkspacePaths.push(directoryPath, filePath);
}

async function seedRendererPromptSources(seed: {
  commandName: string;
  skillName: string;
  subagentName: string;
  whiteboardName: string;
}) {
  const result = (await browser.execute(
    (workspacePath, provider, currentSeed) => {
      const e2eWindow = window as unknown as {
        __skillStoreE2E?: { setState: (state: Record<string, unknown>) => void };
        __subagentsStoreE2E?: { setState: (state: Record<string, unknown>) => void };
        __whiteboardStoreE2E?: {
          getState: () => {
            createBoard: (params: {
              defaultNamePrefix: string;
              workspacePath: string;
            }) => { id: string };
            renameBoard: (params: {
              boardId: string;
              name: string;
              workspacePath: string;
            }) => void;
          };
        };
        __cfSessionStoreE2E?: {
          getState: () => {
            setSlashCommands: (
              workspacePath: string,
              commands: Array<{
                description: string;
                inputHint: string;
                name: string;
                source: "custom";
              }>,
            ) => void;
          };
        };
      };
      const sessionStore = e2eWindow.__cfSessionStoreE2E;
      const skillStore = e2eWindow.__skillStoreE2E;
      const subagentsStore = e2eWindow.__subagentsStoreE2E;
      const whiteboardStore = e2eWindow.__whiteboardStoreE2E;
      if (!sessionStore || !skillStore || !subagentsStore || !whiteboardStore) {
        return {
          ok: false,
          reason: "missing-e2e-store-bridge",
          bridges: {
            session: Boolean(sessionStore),
            skill: Boolean(skillStore),
            subagents: Boolean(subagentsStore),
            whiteboard: Boolean(whiteboardStore),
          },
        };
      }

      sessionStore.getState().setSlashCommands(workspacePath, [
        {
          name: currentSeed.commandName,
          description: "E2E custom slash command for composer prefix routing",
          inputHint: `/${currentSeed.commandName} <topic>`,
          source: "custom",
        },
      ]);

      skillStore.setState({
        workspacePath,
        workspaceIdentity: null,
        loadedWorkspacePath: workspacePath,
        loadedWorkspaceIdentity: null,
        provider,
        loadedProvider: provider,
        loading: false,
        error: null,
        capability: { userScopeAvailable: true },
        skills: [
          {
            id: `glm:${currentSeed.skillName}`,
            name: currentSeed.skillName,
            description: "E2E skill for composer prefix routing",
            body: "Use this skill only for E2E prefix routing.",
            path: `${workspacePath}/.cf/skills/${currentSeed.skillName}/SKILL.md`,
            scope: "workspace",
            enabled: true,
          },
        ],
      });

      subagentsStore.setState({
        workspacePath,
        workspaceIdentity: null,
        loadedWorkspacePath: workspacePath,
        loadedWorkspaceIdentity: null,
        provider,
        loadedProvider: provider,
        loading: false,
        error: null,
        capability: { userScopeAvailable: true },
        agents: [
          {
            id: `e2e-${currentSeed.subagentName}`,
            name: currentSeed.subagentName,
            description: "E2E subagent for composer prefix routing",
            systemPrompt: "You are only used by an E2E composer suggestion case.",
            path: `${workspacePath}/.cf/agents/${currentSeed.subagentName}.md`,
            scope: "workspace",
            source: "user",
            enabled: true,
          },
        ],
      });

      const board = whiteboardStore.getState().createBoard({
        workspacePath,
        defaultNamePrefix: "E2E route board",
      });
      whiteboardStore.getState().renameBoard({
        workspacePath,
        boardId: board.id,
        name: currentSeed.whiteboardName,
      });

      return { ok: true, boardId: board.id };
    },
    DEFAULT_WORKSPACE,
    CF_AGENT_PROVIDER,
    seed,
  )) as { ok: boolean; reason?: string; bridges?: Record<string, boolean> };

  if (!result.ok) {
    throw new Error(`composer prefix routing seed failed: ${JSON.stringify(result)}`);
  }
}

async function setComposerText(text: string) {
  await browser.waitUntil(
    async () =>
      browser.execute((inputTestId, nextText) => {
        const input = document.querySelector<HTMLElement>(
          `[data-testid="${inputTestId}"]`,
        ) as (HTMLElement & {
          __cfLexicalInputE2E?: {
            focus: () => void;
            setText: (value: string) => void;
          };
        }) | null;
        const bridge = input?.__cfLexicalInputE2E;
        if (!bridge) {
          return false;
        }
        bridge.setText(nextText);
        bridge.focus();
        return true;
      }, TID_V4_COMPOSER_INPUT, text),
    {
      timeout: 10000,
      timeoutMsg: `composer prefix routing: Input框 E2E bridge 未就绪，无法Input ${text}`,
    },
  );
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

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getPanelSnapshot(): Promise<PanelSnapshot> {
  return browser.execute(
    (panelTestId, optionPrefix, statusPrefix) => {
      const panel = document.querySelector<HTMLElement>(
        `[data-testid="${panelTestId}"]`,
      );
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

function assertPanelExcludesSections(snapshot: PanelSnapshot, excludedSectionIds: string[]) {
  const actualSectionIds = optionSectionIds(snapshot);
  for (const excluded of excludedSectionIds) {
    expect(actualSectionIds).not.toContain(excluded);
  }
}

async function waitForComposerMarkdown(expected: string, timeoutMsg: string) {
  await browser.waitUntil(async () => (await getComposerMarkdown()).trim() === expected, {
    timeout: 10000,
    timeoutMsg,
  });
}

async function waitForComposerMarkdownContaining(expected: string, timeoutMsg: string) {
  await browser.waitUntil(async () => (await getComposerMarkdown()).includes(expected), {
    timeout: 10000,
    timeoutMsg,
  });
}

function getComposerMarkdown(): Promise<string> {
  return browser.execute((inputTestId) => {
    const input = document.querySelector<HTMLElement>(
      `[data-testid="${inputTestId}"]`,
    ) as (HTMLElement & {
      __cfLexicalInputE2E?: { getText: () => string };
    }) | null;
    return input?.__cfLexicalInputE2E?.getText() ?? "";
  }, TID_V4_COMPOSER_INPUT);
}
