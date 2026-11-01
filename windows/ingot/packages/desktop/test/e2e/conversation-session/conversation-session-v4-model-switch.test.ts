import { clearAppData } from "../helpers/desktop-app.js";
import {
  UPSTREAM_MODEL,
  UPSTREAM_PROVIDER_ID,
} from "../helpers/upstream-provider.js";
import {
  getV4ModelConfig,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Model,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

describe("v4 M4 门禁：switchModelConfig", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("建立 session → 应用模型配置（thought=max）→ config 投影更新", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_V4_MODEL_SWITCH_SEED 建立会话");
    await waitForV4TimelineContaining("V4_MODEL_SWITCH_SEED_OK", 45000);
    await waitForV4Pane(
      (s) => s.sessionId !== "draft" && s.sessionId !== null,
      "会话没有建立",
      45000,
    );

    await switchV4Model(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL, "max");

    await browser.waitUntil(
      async () => {
        const cfg = await getV4ModelConfig();
        return cfg.model === UPSTREAM_MODEL && cfg.thought === "max";
      },
      { timeout: 30000, timeoutMsg: "模型 config 没有更新为目标值" },
    );
    const cfg = await getV4ModelConfig();
    expect(cfg.provider).toBe(UPSTREAM_PROVIDER_ID);
    expect(cfg.model).toBe(UPSTREAM_MODEL);
    expect(cfg.thought).toBe("max");
  });
});
