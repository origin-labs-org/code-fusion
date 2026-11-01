import { readFile } from "node:fs/promises";
import { clearAppData } from "../helpers/desktop-app.js";
import { prepareV4ConversationE2E } from "../helpers/v4-conversation.js";
import { registerMentionSelectionCases } from "../helpers/mention-selection-cases.js";

describe("mention selection and canonical clipboard", () => {
  before(async () => {
    await prepareV4ConversationE2E();
    await assertNoProviderRequests();
  });
  afterEach(async () => {
    await assertNoProviderRequests();
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });
  registerMentionSelectionCases();
});

async function assertNoProviderRequests() {
  const capturePath = process.env.E2E_PROVIDER_CAPTURE_PATH?.trim();
  if (!capturePath)
    throw new Error("Provider capture path is required for the no-request assertion");
  const capture = JSON.parse(await readFile(capturePath, "utf8"));
  expect(capture.records).toEqual([]);
}
