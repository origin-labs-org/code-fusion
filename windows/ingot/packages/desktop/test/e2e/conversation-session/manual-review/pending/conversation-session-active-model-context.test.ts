import { TID_SETTINGS_BACK_BUTTON } from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  waitForWorkspaceApp,
} from "../../../helpers/desktop-app.js";
import { createCustomOpenAIChatCompletionsProvider } from "../../../helpers/custom-openai-provider.js";
import { startConversationModelProviderReplayServer } from "../../../helpers/model-provider-replay.js";
import {
  assertUpstreamRequestCapture,
  waitForUpstreamNetworkCapture,
} from "../../../helpers/upstream-capture.js";
import {
  getSelectedUpstreamModelLabel,
  getUpstreamProviderModelValues,
  selectUpstreamProviderModelById,
} from "../../../helpers/upstream-provider.js";
import {
  prepareConversationE2E,
  sendPrompt,
  waitForChatState,
  waitForComposerText,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

const CASE_NAME = "conversation-session-active-model-context";
const MODEL_ID = "glm-5.2";
let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>>;

describe("Todo 68: First request upon consecutive switching of models with the same name", () => {
  before(async () => {
    replay = await startConversationModelProviderReplayServer(CASE_NAME);
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
    await replay?.stop();
  });

  it("Same Session A → B → C → A, Context and request do not lag by one turn", async function () {
    this.timeout(360000);
    await prepareConversationE2E({ skipProvider: true });
    const providers = [];
    for (const label of ["A", "B", "C"]) {
      const baseURL = `${replay.baseUrl}/active-model-${label.toLowerCase()}`;
      const provider = await createCustomOpenAIChatCompletionsProvider({
        baseURL,
        modelId: MODEL_ID,
        providerName: `Active Model ${label}`,
      });
      providers.push({ provider, baseURL });
      await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
      await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
    }

    let sessionId: string | null = null;
    for (const [step, providerIndex] of [0, 1, 2, 0].entries()) {
      const { provider, baseURL } = providers[providerIndex]!;
      await selectUpstreamProviderModelById(MODEL_ID, {
        providerId: provider.id,
        providerName: provider.name,
        includePlainModelFallback: false,
      }).catch(async (error: unknown) => {
        await browser.saveScreenshot(".e2e-artifacts/todo68-selection-failure.png");
        const diagnostic = await browser.execute(() => {
          const trigger = document.querySelector<HTMLButtonElement>(
            '[data-testid="chat-model-select-trigger"]',
          );
          const rect = trigger?.getBoundingClientRect();
          return {
            disabled: trigger?.disabled,
            trigger: trigger?.outerHTML,
            covering: rect
              ? document
                  .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
                  ?.outerHTML.slice(0, 1500)
              : null,
            text: document.body.innerText.slice(-3000),
          };
        });
        throw new Error(`${String(error)}; ${JSON.stringify(diagnostic)}`, { cause: error });
      });
      const selected = await getSelectedUpstreamModelLabel();
      expect(
        getUpstreamProviderModelValues(MODEL_ID, {
          providerId: provider.id,
          includePlainModelFallback: false,
        }),
      ).toContain(selected.currentValue);

      const marker = `E2E_ACTIVE_MODEL_CONTEXT_STEP_${step}`;
      const prompt = `${marker}: Reply with active-model-context-ok.`;
      await sendPrompt(prompt);
      await waitForComposerText("", "Input box not cleared after sending");
      await waitForUserMessageContaining(marker);
      const record = await waitForUpstreamNetworkCapture(marker);
      assertUpstreamRequestCapture(record, { expectedText: prompt, model: MODEL_ID });
      expect(new URL(record.url).pathname).toBe(`${new URL(baseURL).pathname}/chat/completions`);
      expect(record.statusCode).toBe(200);

      const body = record.requestJson as { messages: Array<{ role: string; content: unknown }> };
      const system = body.messages
        .filter((message) => message.role === "system")
        .map((message) => JSON.stringify(message.content))
        .join("\n");
      expect(system).toContain(`powered by the model named ${provider.id}/${MODEL_ID}.`);
      for (const other of providers.filter((candidate) => candidate.provider.id !== provider.id)) {
        expect(system).not.toContain(
          `powered by the model named ${other.provider.id}/${MODEL_ID}.`,
        );
      }
      const state = await waitForChatState(
        (snapshot) =>
          snapshot.state === "idle" && snapshot.queueCount === 0 && Boolean(snapshot.sessionId),
        "模型回复后没有回到 idle",
        60000,
      );
      if (sessionId) expect(state.sessionId).toBe(sessionId);
      sessionId = state.sessionId;
      if (step > 0) {
        await browser.waitUntil(
          async () => {
            const latest = await browser.execute(
              () =>
                Array.from(
                  document.querySelectorAll<HTMLElement>('[data-marker-type="modelChange"]'),
                ).at(-1)?.innerText ?? "",
            );
            const target = latest.split("→").at(-1) ?? "";
            return target.includes(provider.name) && target.includes(MODEL_ID);
          },
          { timeout: 15000, timeoutMsg: "Switch tag did not display target Provider" },
        );
      }
    }
  });
});
