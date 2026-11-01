import { TID_CHAT_ERROR_BANNER } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import { prepareHighspeedDrawWorkspace } from "../../../helpers/highspeed-card.js";
import { E2E_BIGMODEL_PLAN_PROVIDER_ID } from "../../../helpers/model-provider-restart.js";
import {
  clickV4QueueItemDelete,
  clickV4QueueItemEdit,
  clickV4Stop,
  getV4ComposerText,
  getV4ModelConfig,
  getV4QueueItems,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4QueueCount,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const RUNNING_PROMPT = "E2E_HIGHSPEED_QUEUE_EDIT_SLOW keep running";
const QUEUED_PROMPT = "E2E_HIGHSPEED_QUEUE_EDIT_PENDING original";
const RESUBMITTED_PROMPT = "E2E_HIGHSPEED_QUEUE_EDIT_RESUBMITTED changed";
const RUNNING_REPLY_TOKEN = "HIGHSPEED_QUEUE_EDIT_STREAMING";
const INTERNAL_HIGHSPEED_PROVIDER = "account:bigmodel-highspeed-card";

describe("Highspeed queued prompt edit E2E", () => {
  afterEach(async () => {
    const queued = await getV4QueueItems();
    for (const item of queued) {
      await clickV4QueueItemDelete(item.queueItemId);
    }
    if (queued.length > 0) await waitForV4QueueCount(0, 30000);

    const pane = await waitForV4Pane(() => true, "Failed to read Highspeed queue pane");
    if (pane.canStop) {
      await clickV4Stop();
      await waitForV4Pane((snapshot) => !snapshot.canStop, "Highspeed queue teardown stop incomplete");
    }
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("HS-E2E-06: Revert to normal model after withdrawing Highspeed queued input; modified resend can still queue", async function () {
    this.timeout(180000);

    await prepareHighspeedDrawWorkspace();
    await sendV4Prompt(RUNNING_PROMPT);
    await waitForV4TimelineContaining(RUNNING_REPLY_TOKEN, 45000);
    await waitForV4Pane(
      (snapshot) => snapshot.canStop,
      "首轮 Highspeed 输入没有保持 running",
      45000,
    );

    await sendV4Prompt(QUEUED_PROMPT);
    await waitForV4QueueCount(1, 30000);
    const [queued] = await getV4QueueItems();
    expect(queued?.text).toContain(QUEUED_PROMPT);
    if (!queued) throw new Error("Highspeed 队列项不存在");

    expect(await clickV4QueueItemEdit(queued.queueItemId)).toBe(true);
    await waitForV4QueueCount(0, 30000);
    await browser.waitUntil(async () => (await getV4ComposerText()) === QUEUED_PROMPT, {
      timeout: 30000,
      timeoutMsg: "Highspeed queue item was not restored to Composer",
    });

    expect(await getV4ModelConfig()).toMatchObject({
      provider: E2E_BIGMODEL_PLAN_PROVIDER_ID,
    });

    await sendV4Prompt(RESUBMITTED_PROMPT);
    await waitForV4QueueCount(1, 30000);
    const [resubmitted] = await getV4QueueItems();
    expect(resubmitted?.queueItemId).not.toBe(queued.queueItemId);
    expect(resubmitted?.text).toContain(RESUBMITTED_PROMPT);
    expect((await getV4ModelConfig()).provider).not.toBe(INTERNAL_HIGHSPEED_PROVIDER);

    const errorBanner = $(`[data-testid="${TID_CHAT_ERROR_BANNER}"]`);
    expect(await errorBanner.isExisting()).toBe(false);
    expect((await $("body").getText()).includes(INTERNAL_HIGHSPEED_PROVIDER)).toBe(false);
  });
});
