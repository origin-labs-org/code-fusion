import {
  UPSTREAM_MODEL,
  UPSTREAM_THOUGHT_LEVEL,
} from "./helpers/upstream-provider.js";
import {
  assertUpstreamRequestCapture,
  assertUpstreamThoughtLevelCapture,
  readUpstreamUsageFromCapture,
  waitForContextUsageFromCapture,
  waitForUpstreamNetworkCapture,
} from "./helpers/upstream-capture.js";
import { clearAppData } from "./helpers/desktop-app.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
} from "./helpers/v4-conversation.js";

const UPSTREAM_REPLY_TOKEN =
  process.env.E2E_PROVIDER_EXPECT_REPLY_TEXT?.trim() || "upstream-e2e-ok";
const UPSTREAM_REQUEST_PROMPT =
  process.env.E2E_PROVIDER_PROMPT?.trim() ||
  `Reply with exactly "${UPSTREAM_REPLY_TOKEN}" and no other text.`;

describe("桌面端 上游 Provider E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Should be able to configure upstream in settings and send messages using the new model", async function () {
    this.timeout(120000);
    await prepareV4ConversationE2E();

    await sendV4Prompt(UPSTREAM_REQUEST_PROMPT);

    const captureRecord = await waitForUpstreamNetworkCapture(UPSTREAM_REQUEST_PROMPT);
    assertUpstreamRequestCapture(captureRecord, {
      expectedText: UPSTREAM_REQUEST_PROMPT,
      model: UPSTREAM_MODEL,
    });
    if (UPSTREAM_THOUGHT_LEVEL) {
      assertUpstreamThoughtLevelCapture(captureRecord, UPSTREAM_THOUGHT_LEVEL);
    }
    await waitForV4AssistantMessageContaining(UPSTREAM_REPLY_TOKEN, 90000);
    await waitForContextUsageFromCapture(readUpstreamUsageFromCapture(captureRecord));
  });
});
