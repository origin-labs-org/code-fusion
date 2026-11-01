import { openWorkspaceDraftFromSidebar } from "../helpers/workspace-agent-warmup.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  clearAppData,
  getE2EAppDataPaths,
  setInputValueByTestIdDom,
} from "../helpers/desktop-app.js";
import { TID_CHAT_ATTACHMENT_BUTTON, TID_V4_COMPOSER_INPUT } from "@origin-ai/cf-shared/test-ids";
import {
  clickV4SlashOption,
  getV4ComposerText,
  getV4SlashOptionIds,
  hasV4SlashPanel,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  waitForV4MentionOptionPrefix,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const SESSION_SKILL_NAME = "e2e-session-skill-catalog";
const SESSION_SKILL_DIRECTORY = join(
  getE2EAppDataPaths().workspace,
  ".cf",
  "skills",
  SESSION_SKILL_NAME,
);
const SESSION_SKILL_PATH = join(SESSION_SKILL_DIRECTORY, "SKILL.md");

function isSessionSkillOption(optionId: string) {
  return optionId.startsWith("skill:") && optionId.includes(SESSION_SKILL_NAME);
}

async function waitForSessionSkillAbsent(trigger: "/" | "$") {
  let snapshot: { hasTarget: boolean; status: string | null } | undefined;
  let stableEmptyPolls = 0;
  await browser.waitUntil(
    async () => {
      if (!(await hasV4SlashPanel())) {
        stableEmptyPolls = 0;
        return false;
      }
      snapshot = await browser.execute((skillName) => {
        const optionIds = Array.from(
          document.querySelectorAll<HTMLElement>("[data-option-id]"),
        ).map((element) => element.dataset.optionId ?? "");
        const status = document
          .querySelector<HTMLElement>('[data-section-id="skills"][data-status]')
          ?.getAttribute("data-status");
        return {
          hasTarget: optionIds.some(
            (optionId) => optionId.startsWith("skill:") && optionId.includes(skillName),
          ),
          status: status ?? null,
        };
      }, SESSION_SKILL_NAME);
      if (snapshot.hasTarget || snapshot.status === "empty" || snapshot.status === "error") {
        return true;
      }
      if (snapshot.status === "loading") {
        stableEmptyPolls = 0;
        return false;
      }
      stableEmptyPolls += 1;
      return stableEmptyPolls >= 3;
    },
    {
      timeout: 15000,
      timeoutMsg: `${trigger} 没有CompletedOld Session Skill catalog Query`,
    },
  );
  expect(snapshot?.status).not.toBe("error");
  expect(snapshot?.hasTarget).toBe(false);
}

async function waitForSessionSkillPresent(trigger: "/" | "$") {
  let optionId: string | undefined;
  await browser.waitUntil(
    async () => {
      optionId = (await getV4SlashOptionIds()).find(isSessionSkillOption);
      return Boolean(optionId);
    },
    {
      timeout: 15000,
      timeoutMsg: `${trigger} 没有展示NewTask重New发现的 Skill: ${SESSION_SKILL_NAME}`,
    },
  );
  return optionId as string;
}

describe("S01 / S05 / S08：composer 候选入口与 Session Skill catalog", () => {
  before(async () => {
    await rm(SESSION_SKILL_DIRECTORY, { recursive: true, force: true });
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await rm(SESSION_SKILL_DIRECTORY, { recursive: true, force: true });
    await clearAppData();
  });

  it("@ 与 # 共用 sessions-index，+ 菜单突出 @、/ 和 $", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_V4_MENTION_SEED 建立可被 mention 的会话");
    await waitForV4TimelineContaining("V4_MENTION_SEED_OK", 45000);
    const seedPane = await waitForV4Pane(
      (s) => !s.canStop && s.sessionId !== "draft" && s.sessionId !== null,
      "首轮没有回到空闲态且绑定 session",
      45000,
    );
    const seedSessionId = seedPane.sessionId;
    if (!seedSessionId || seedSessionId === "draft") {
      throw new Error(`没有拿到可引用的 seed session: ${JSON.stringify(seedPane)}`);
    }

    await openWorkspaceDraftFromSidebar(getE2EAppDataPaths().workspace);

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "@E2E_V4_MENTION_SEED", {
      timeout: 15000,
      timeoutMsg: "v4 composer input box did not appear or is not editable",
    });
    const atSessionOptionId = await waitForV4MentionOptionPrefix("session:");
    expect(atSessionOptionId.startsWith("session:")).toBe(true);
    expect(await clickV4SlashOption(atSessionOptionId)).toBe(true);
    await browser.waitUntil(
      async () => ((await getV4ComposerText()) ?? "").includes(`#${seedSessionId}`),
      {
        timeout: 15000,
        timeoutMsg: "@ 会话候选没有写入原 #session-id canonical mention",
      },
    );
    await browser.waitUntil(async () => !(await hasV4SlashPanel()), {
      timeout: 15000,
      timeoutMsg: "选中 @ 会话候选后面板没有关闭",
    });

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "#E2E_V4_MENTION_SEED", {
      timeout: 15000,
      timeoutMsg: "v4 composer input box did not appear or is not editable",
    });
    const hashSessionOptionId = await waitForV4MentionOptionPrefix("session:");
    expect(hashSessionOptionId).toBe(atSessionOptionId);
    expect(await clickV4SlashOption(hashSessionOptionId)).toBe(true);
    await browser.waitUntil(
      async () => ((await getV4ComposerText()) ?? "").includes(`#${seedSessionId}`),
      {
        timeout: 15000,
        timeoutMsg: "# 会话候选没有写入原 #session-id canonical mention",
      },
    );
    await browser.waitUntil(async () => !(await hasV4SlashPanel()), {
      timeout: 15000,
      timeoutMsg: "选中 # 会话候选后面板没有关闭",
    });

    let expectedSkillOptionId: string | undefined;
    let expectedSkillMarkdown: string | undefined;
    for (const skillTrigger of ["$", "¥", "￥"] as const) {
      await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, skillTrigger, {
        timeout: 15000,
        timeoutMsg: `无法Input Skills Compatible触发器 ${skillTrigger}`,
      });
      const skillOptionId = await waitForV4MentionOptionPrefix("skill:");
      expect(skillOptionId.startsWith("skill:")).toBe(true);
      if (expectedSkillOptionId) {
        expect(skillOptionId).toBe(expectedSkillOptionId);
      } else {
        expectedSkillOptionId = skillOptionId;
      }
      expect(await clickV4SlashOption(skillOptionId)).toBe(true);
      let selectedSkillMarkdown: string | undefined;
      await browser.waitUntil(
        async () => {
          selectedSkillMarkdown = (await getV4ComposerText()) ?? undefined;
          return Boolean(
            selectedSkillMarkdown?.startsWith("[$") && selectedSkillMarkdown.includes("SKILL.md)"),
          );
        },
        {
          timeout: 15000,
          timeoutMsg: `${skillTrigger} 候选没有Write原 Skill canonical mention`,
        },
      );
      if (expectedSkillMarkdown) {
        expect(selectedSkillMarkdown).toBe(expectedSkillMarkdown);
      } else {
        expectedSkillMarkdown = selectedSkillMarkdown;
      }
      await browser.waitUntil(async () => !(await hasV4SlashPanel()), {
        timeout: 15000,
        timeoutMsg: `选Medium ${skillTrigger} Skill 候选后面板没有Close`,
      });
    }

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "", {
      timeout: 15000,
      timeoutMsg: "验证动作菜单前无法清空输入框",
    });
    const actionMenuButton = await $(`[data-testid="${TID_CHAT_ATTACHMENT_BUTTON}"]`);
    await actionMenuButton.waitForDisplayed({ timeout: 15000 });
    await actionMenuButton.click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const triggers = Array.from(
            document.querySelectorAll<HTMLElement>('[data-trigger="+"] code'),
          ).map((element) => element.textContent);
          return JSON.stringify(triggers) === JSON.stringify(["@", "/", "$"]);
        }),
      {
        timeout: 15000,
        timeoutMsg: "+ 菜单没有按顺序展示 @ / / / $ 提示",
      },
    );
    await browser.keys("Escape");
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "$", { timeout: 15000 });
    expect((await waitForV4MentionOptionPrefix("skill:")).startsWith("skill:")).toBe(true);
    await browser.keys("Escape");

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "", {
      timeout: 15000,
      timeoutMsg: "v4 composer input box did not appear or is not editable",
    });

    await selectV4TaskById(seedSessionId);
    await mkdir(SESSION_SKILL_DIRECTORY, { recursive: true });
    await writeFile(
      SESSION_SKILL_PATH,
      [
        "---",
        `name: ${SESSION_SKILL_NAME}`,
        "description: E2E fixture for the Session Skill catalog lifecycle.",
        "---",
        "",
        "# Session Skill Catalog E2E",
      ].join("\n"),
      "utf-8",
    );

    for (const trigger of ["/", "$"] as const) {
      await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, `${trigger}${SESSION_SKILL_NAME}`, {
        timeout: 15000,
        timeoutMsg: `无法在Old Session Input Skill 触发器 ${trigger}`,
      });
      await waitForSessionSkillAbsent(trigger);
      await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "", {
        timeout: 15000,
        timeoutMsg: `Old Session ${trigger} 断言后没有Clear composer`,
      });
    }

    await openWorkspaceDraftFromSidebar(getE2EAppDataPaths().workspace);
    let slashSkillOptionId: string | undefined;
    for (const trigger of ["/", "$"] as const) {
      await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, `${trigger}${SESSION_SKILL_NAME}`, {
        timeout: 15000,
        timeoutMsg: `无法在NewTaskInput Skill 触发器 ${trigger}`,
      });
      const optionId = await waitForSessionSkillPresent(trigger);
      if (slashSkillOptionId) {
        expect(optionId).toBe(slashSkillOptionId);
      } else {
        slashSkillOptionId = optionId;
      }
      await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "", {
        timeout: 15000,
        timeoutMsg: `NewTask ${trigger} 断言后没有Clear composer`,
      });
    }
  });
});
