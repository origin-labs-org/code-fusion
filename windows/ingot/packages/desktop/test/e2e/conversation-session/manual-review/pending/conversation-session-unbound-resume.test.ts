import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { TID_V4_MODEL_CONFIG, TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER } from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  getE2EAppDataPaths,
} from "../../../helpers/desktop-app.js";
import { startConversationModelProviderReplayServer } from "../../../helpers/model-provider-replay.js";
import { restartIntoWorkspacePreservingProfile } from "../../../helpers/model-provider-restart-runtime.js";
import { seedReplayProvider } from "../../../helpers/model-provider-restart.js";
import {
  UPSTREAM_MODEL,
  UPSTREAM_PROVIDER_ID,
  UPSTREAM_PROVIDER_NAME,
  selectRegistryProviderModelById,
  selectUpstreamThoughtLevelValue,
} from "../../../helpers/upstream-provider.js";
import { prepareConversationE2E } from "../../../helpers/conversation-session.js";
import {
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
  selectV4TaskById,
} from "../../../helpers/v4-conversation.js";
import { waitForUpstreamNetworkCapture } from "../../../helpers/upstream-capture.js";

const CASE_NAME = "conversation-session-unbound-resume";
let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>>;

describe("Todo 70：模型选择残缺不阻止历史打开", () => {
  before(async () => {
    replay = await startConversationModelProviderReplayServer(CASE_NAME);
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
    await replay?.stop();
  });

  it("DB109: Startup migration/rollback missing fields and broken choices do not block history; continue original session after reselection", async function () {
    this.timeout(480000);
    await prepareConversationE2E({ skipProvider: true });
    await seedReplayProvider({
      id: UPSTREAM_PROVIDER_ID,
      models: [UPSTREAM_MODEL],
      name: UPSTREAM_PROVIDER_NAME,
    });
    await restartIntoWorkspacePreservingProfile(DEFAULT_WORKSPACE);
    await prepareConversationE2E({ skipProvider: true });
    const selectModel = () =>
      selectRegistryProviderModelById(UPSTREAM_MODEL, {
        providerId: UPSTREAM_PROVIDER_ID,
        providerName: UPSTREAM_PROVIDER_NAME,
        includePlainModelFallback: false,
      });
    await selectModel();
    await sendV4Prompt("E2E_UNBOUND_RESUME_HISTORY: Reply unbound-history-ok.");
    const firstRequest = await waitForUpstreamNetworkCapture("E2E_UNBOUND_RESUME_HISTORY").catch(
      async (error: unknown) => {
        await browser.execute(() => {
          const details = [...document.querySelectorAll("button")].find((button) =>
            /Expand details|Show details/i.test(button.textContent ?? ""),
          );
          details?.click();
        });
        await browser.saveScreenshot(".e2e-artifacts/todo70-first-send-failure.png");
        const diagnostic = await browser.execute(() => ({
          text: document.body.innerText.slice(-7000),
          config: document.querySelector('[data-testid="v4-model-config"]')?.outerHTML,
        }));
        throw new Error(`${String(error)}; ${JSON.stringify(diagnostic)}`, { cause: error });
      },
    );
    expect(firstRequest.statusCode).toBe(200);
    await waitForV4TimelineContaining("unbound-history-ok");
    const created = await waitForV4Pane(
      (state) => Boolean(state.sessionId) && state.sessionId !== "draft" && !state.canStop,
      "历史首轮未完成",
      60000,
    );
    const sessionId = created.sessionId!;
    const choices = [
      { providerId: UPSTREAM_PROVIDER_ID, modelId: UPSTREAM_MODEL },
      {
        providerId: UPSTREAM_PROVIDER_ID,
        modelId: UPSTREAM_MODEL,
        options: { reasoningLevel: "removed" },
      },
      {
        providerId: "removed-provider",
        modelId: UPSTREAM_MODEL,
        options: { reasoningLevel: "high" },
      },
      undefined,
    ];
    let migrationLedger: unknown;
    for (const [index, selection] of choices.entries()) {
      await browser.execute(
        (workspacePath, targetSessionId) => {
          const key = `cf-v4-composer-drafts:v1:${encodeURIComponent(workspacePath)}`;
          const raw = localStorage.getItem(key);
          if (!raw) return;
          const file = JSON.parse(raw);
          delete file.scopes[targetSessionId];
          localStorage.setItem(key, JSON.stringify(file));
        },
        DEFAULT_WORKSPACE,
        sessionId,
      );
      await restartIntoWorkspacePreservingProfile(DEFAULT_WORKSPACE, {
        afterElectronProcessExit: () => {
          const db = new DatabaseSync(
            join(getE2EAppDataPaths().storageRoot, "cli", "db", "db.sqlite"),
          );
          try {
            if (index === 0) {
              db.prepare(
                "DELETE FROM schema_migration WHERE id='0020_provider_model_selection'",
              ).run();
              db.prepare(
                "UPDATE message SET data=json_set(json_remove(data,'$.modelSelection'),'$.model',json('{}')) WHERE session_id=? AND json_extract(data,'$.role')='user'",
              ).run(sessionId);
            }
            if (index === 3) {
              migrationLedger = db.prepare("SELECT * FROM schema_migration ORDER BY id").all();
              db.prepare(
                "UPDATE message SET data=json_remove(data,'$.modelSelection') WHERE session_id=? AND json_extract(data,'$.role')='user'",
              ).run(sessionId);
            }
            const persisted =
              index === 0 || index === 3
                ? { providerId: UPSTREAM_PROVIDER_ID, modelId: UPSTREAM_MODEL }
                : { modelSelection: selection };
            const result = db
              .prepare(
                "update session_entry set data = ? where session_id = ? and type = 'runtime/model_selection'",
              )
              .run(JSON.stringify(persisted), sessionId);
            if (!Number(result.changes))
              throw new Error(
                JSON.stringify({
                  sessionId,
                  entries: db.prepare("select session_id,type from session_entry limit 15").all(),
                  sessions: db.prepare("select id,title from session limit 10").all(),
                }),
              );
          } finally {
            db.close();
          }
        },
      });
      await selectV4TaskById(sessionId, 30000);
      await waitForV4TimelineContaining("unbound-history-ok");
      await waitForV4TimelineContaining("E2E_UNBOUND_RESUME_HISTORY");
      const visibleText = await browser.execute(() => document.body.innerText);
      expect(visibleText).not.toMatch(
        /ZodError|invalid_type|Expected object|Invalid input|ReadFailed|加载Failed/,
      );
      const db = new DatabaseSync(
        join(getE2EAppDataPaths().storageRoot, "cli", "db", "db.sqlite"),
        { readOnly: true },
      );
      try {
        const row = db
          .prepare(
            "SELECT data FROM session_entry WHERE session_id=? AND type='runtime/model_selection'",
          )
          .get(sessionId)!;
        const data = JSON.parse(String(row.data));
        if (index === 0) {
          expect(data).toEqual({
            providerId: UPSTREAM_PROVIDER_ID,
            modelId: UPSTREAM_MODEL,
            modelSelection: choices[0],
          });
          expect(
            db
              .prepare("SELECT id FROM schema_migration WHERE id='0020_provider_model_selection'")
              .get(),
          ).toBeDefined();
        }
        if (index === 3) {
          expect(data).not.toHaveProperty("modelSelection");
          expect(db.prepare("SELECT * FROM schema_migration ORDER BY id").all()).toEqual(
            migrationLedger,
          );
        }
      } finally {
        db.close();
      }
      const config = await browser.execute((tid) => {
        const el = document.querySelector<HTMLElement>(`[data-testid="${tid}"]`);
        return { model: el?.dataset.model ?? "", thought: el?.dataset.thought ?? "" };
      }, TID_V4_MODEL_CONFIG);
      expect(config.thought).toBe("");
      if (index >= 2) expect(config.model).toBe("");
      else {
        expect(config.model).toBe(UPSTREAM_MODEL);
        const thoughtTrigger = await $(`[data-testid="${TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER}"]`);
        expect(await thoughtTrigger.getAttribute("aria-label")).toMatch(
          /选择Thinking档位|Select reasoning level/,
        );
        expect(await thoughtTrigger.getText()).toMatch(/选择Thinking档位|Select reasoning level/);
      }
      await browser.saveScreenshot(`.e2e-artifacts/todo70-unbound-${index}.png`);
      await selectModel();
      await selectUpstreamThoughtLevelValue("high");
      const marker = `E2E_UNBOUND_RESUME_CONTINUE_${index}`;
      await sendV4Prompt(`${marker}: Reply unbound-continue-${index}-ok.`);
      await waitForV4TimelineContaining(`unbound-continue-${index}-ok`);
      const resumed = await waitForV4Pane(
        (state) => state.sessionId === sessionId && !state.canStop,
        "重选后未完成",
        60000,
      );
      expect(resumed.sessionId).toBe(sessionId);
      const request = await waitForUpstreamNetworkCapture(marker);
      expect(request.statusCode).toBe(200);
      expect(request.requestJson).toMatchObject({ model: UPSTREAM_MODEL });
    }
  });
});
