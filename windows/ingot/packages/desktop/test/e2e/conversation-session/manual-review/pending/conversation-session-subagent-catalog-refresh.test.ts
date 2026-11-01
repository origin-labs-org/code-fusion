import { readMessageTextBlocks } from "../../../helpers/subagent-listing-assertions.js";
import {
  useEnglishSubagentSettings,
  finishSubagentTurn,
} from "../../../helpers/subagent-refresh-conversation.js";
import {
  readSubagentCapture,
  waitForSubagentRequest,
  assertSubagentProfile,
  readChildSessionIds,
  readSubagentId as latestAgentId,
} from "../../../helpers/subagent-refresh-capture.js";
import { clearAppData } from "../../../helpers/desktop-app.js";
import { prepareIncomingMessageCapability } from "../../../helpers/incoming-message-capability.js";
import {
  UPSTREAM_MODEL,
  UPSTREAM_PROVIDER_ID,
  UPSTREAM_ALTERNATE_MODEL,
  UPSTREAM_ALTERNATE_PROVIDER_ID,
} from "../../../helpers/upstream-provider.js";
import { exportPromptTrajectory } from "../../../helpers/prompt-trajectory-export.js";
import {
  assertParentRequestHistory,
  type CapturedPrompt,
} from "../../../helpers/provider-prefix.js";
import {
  saveRefreshProfile,
  setRefreshProfileEnabled,
  deleteRefreshProfile,
  type RefreshProfile,
} from "../../../helpers/subagent-refresh-settings.js";
import type { E2ENetworkCaptureRecord } from "../../../helpers/network-capture-proxy.js";
import {
  getV4PaneSnapshot,
  sendV4PromptAndWaitAccepted,
  assertVisibleV4UserMessagesNotContaining,
} from "../../../helpers/v4-conversation.js";

const INITIAL = "Available agent types for the Agent tool:";
const ADDED = "New agent types are now available for the Agent tool:";
const REMOVED = "The following agent types are no longer available:";

describe("Subagent 动态目录与父请求前缀", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });
  for (const mode of ["user", "mcs"] as const) {
    it(`SHR04-SHR08 ${mode}: 已Run session 增删更名、启停、CompleteConfiguration更New，导出单段轨迹`, async function () {
      this.timeout(300000);
      await prepareIncomingMessageCapability(mode === "mcs");
      await useEnglishSubagentSettings();
      const a: RefreshProfile = {
        name: `e2e-refresh-a-${mode}`,
        description: "E2E_SCR_DESCRIPTION_OLD",
        prompt: "E2E_SCR_PROFILE_OLD",
        model: UPSTREAM_MODEL,
        provider: UPSTREAM_PROVIDER_ID,
        effort: "low",
        tools: ["Read"],
      };
      const b = { ...a, name: `e2e-refresh-b-${mode}` };
      const updated: RefreshProfile = {
        ...b,
        description: "E2E_SCR_DESCRIPTION_NEW",
        prompt: "E2E_SCR_PROFILE_NEW",
        model: UPSTREAM_ALTERNATE_MODEL,
        provider: UPSTREAM_ALTERNATE_PROVIDER_ID,
        effort: "high",
        tools: ["Grep"],
      };
      await turn(mode, "seed", "Remember this conversation. Reply with the requested done marker.");
      const sessionId = (await getV4PaneSnapshot()).sessionId!;
      expect(sessionId).not.toBe("draft");
      let manifest: Awaited<ReturnType<typeof exportPromptTrajectory>>;
      try {
        const seed = await record(mode, "seed");
        expect(listings(seed).length).toBe(1);
        expect(JSON.stringify(seed.requestJson)).not.toContain(a.name);

        await saveRefreshProfile(a);
        await turn(mode, "add", `Launch ${a.name} with prompt ${marker(mode, "add")}_CHILD.`);
        assertProfile(await record(mode, "add-child"), a);
        const added = await record(mode, "add-final");
        assertListing(added, 2, mode, [ADDED, `- ${a.name}:`]);
        const aId = latestAgentId(added);
        const afterA = children(sessionId);
        expect(afterA).toHaveLength(1);

        await saveRefreshProfile(b, a.name);
        await rejectRemoved(mode, "renamed-old", a, aId, sessionId);
        const renamed = await record(mode, "renamed-old-final");
        assertListing(renamed, 3, mode, [ADDED, `- ${b.name}:`, REMOVED, `- ${a.name}`]);
        expect(children(sessionId)).toEqual(afterA);
        await turn(
          mode,
          "renamed-new",
          `Launch ${b.name} with prompt ${marker(mode, "renamed-new")}_CHILD.`,
        );
        assertProfile(await record(mode, "renamed-new-child"), b);
        expect(children(sessionId)).toHaveLength(2);

        await saveRefreshProfile(updated, b.name);
        await turn(mode, "update", `Launch ${b.name} with prompt ${marker(mode, "update")}_CHILD.`);
        assertProfile(await record(mode, "update-child"), updated);
        const updateFinal = await record(mode, "update-final");
        expect(listings(updateFinal)).toEqual(listings(renamed));
        expect(JSON.stringify(listings(updateFinal))).not.toContain(updated.description);
        expect(children(sessionId)).toHaveLength(3);

        await setRefreshProfileEnabled(b.name, false);
        await rejectRemoved(mode, "disabled", b, latestAgentId(updateFinal), sessionId);
        assertListing(await record(mode, "disabled-final"), 4, mode, [REMOVED, `- ${b.name}`]);
        await setRefreshProfileEnabled(b.name, true);
        await turn(
          mode,
          "reenabled",
          `Launch ${b.name} with prompt ${marker(mode, "reenabled")}_CHILD.`,
        );
        assertProfile(await record(mode, "reenabled-child"), updated);
        const reenabled = await record(mode, "reenabled-final");
        assertListing(reenabled, 5, mode, [ADDED, `- ${b.name}:`, updated.description]);
        expect(children(sessionId)).toHaveLength(4);
        await deleteRefreshProfile(b.name);
        await rejectRemoved(mode, "deleted", b, latestAgentId(reenabled), sessionId);
        assertListing(await record(mode, "deleted-final"), 6, mode, [REMOVED, `- ${b.name}`]);
        expect((await getV4PaneSnapshot()).sessionId).toBe(sessionId);
        for (const heading of [INITIAL, ADDED, REMOVED]) {
          await assertVisibleV4UserMessagesNotContaining(heading);
        }
      } finally {
        manifest = await exportPromptTrajectory(sessionId, `subagent-catalog-${mode}`);
      }
      const requests = (await readSubagentCapture()).filter(
        (r) =>
          r.replay?.fixtureId?.startsWith(`scr-${mode}-`) &&
          !r.replay.fixtureId.endsWith("-child") &&
          !r.replay.fixtureId.endsWith("-title"),
      );
      expect(requests).toHaveLength(15);
      const bodies = requests.map((r) => r.requestJson as CapturedPrompt);
      assertParentRequestHistory(bodies);
      expect(manifest!.trajectories).toHaveLength(1);
      expect(manifest!.trajectories[0]).toMatchObject({
        reason: "initial",
        requestCount: requests.length,
      });
      expect(
        (await readSubagentCapture()).some(
          (r) =>
            JSON.stringify(r.requestJson).includes(marker(mode, "seed")) &&
            JSON.stringify(r.requestJson).includes("CRITICAL: Respond with TEXT ONLY"),
        ),
      ).toBe(false);
    });
  }
});
function marker(mode: string, stage: string) {
  return `E2E_SCR_${mode.toUpperCase()}_${stage.toUpperCase().replaceAll("-", "_")}`;
}
async function turn(mode: string, stage: string, instruction: string) {
  const token = marker(mode, stage);
  await sendV4PromptAndWaitAccepted(`${token}: ${instruction}`, token, `未接收 ${token}`);
  await finishSubagentTurn(`${token}_DONE`, 60000);
}
function listings(record: E2ENetworkCaptureRecord) {
  return readMessageTextBlocks(record.requestJson as CapturedPrompt).filter((block) =>
    [INITIAL, ADDED, REMOVED].some((heading) => block.text.includes(heading)),
  );
}
function assertListing(
  record: E2ENetworkCaptureRecord,
  count: number,
  mode: string,
  contents: string[],
) {
  const list = listings(record);
  expect(list).toHaveLength(count);
  expect(list.at(-1)?.role).toBe(mode === "mcs" ? "system" : "user");
  for (const text of contents) expect(list.at(-1)?.text).toContain(text);
}
function assertProfile(record: E2ENetworkCaptureRecord, profile: RefreshProfile) {
  expect(record.statusCode).toBe(200);
  assertSubagentProfile(record, profile);
}
const children = (sessionId: string) => readChildSessionIds(sessionId, "id");
const record = (mode: string, stage: string) =>
  waitForSubagentRequest(`scr-${mode}-${stage}`, 15000);
async function rejectRemoved(
  mode: string,
  stage: string,
  profile: RefreshProfile,
  agentId: string,
  sessionId: string,
) {
  const before = children(sessionId);
  const beforeCapture = (await readSubagentCapture()).length;
  await turn(
    mode,
    stage,
    `Attempt Agent ${profile.name} and SendMessage to agentId: ${agentId}; report both errors.`,
  );
  const request = (await record(mode, `${stage}-final`)).requestJson as CapturedPrompt;
  const results = request.messages
    .flatMap((m) =>
      typeof m.content === "string"
        ? [{ type: "text", text: m.content }]
        : Array.isArray(m.content)
          ? m.content
          : [],
    )
    .filter(
      (b) => b.type === "tool_result" && b.tool_use_id.startsWith(`toolu_scr_${mode}_${stage}_`),
    );
  expect(results).toHaveLength(2);
  expect(JSON.stringify(results)).toContain(`Agent type '${profile.name}' not found`);
  expect(JSON.stringify(results)).toContain(`profile ${profile.name} is unavailable`);
  expect(results.find((r) => r.tool_use_id.endsWith("_spawn"))?.is_error).toBe(true);
  expect(results.find((r) => r.tool_use_id.endsWith("_resume"))?.content).toBe(
    `Cannot resume local agent ${agentId}: profile ${profile.name} is unavailable.`,
  );
  expect(children(sessionId)).toEqual(before);
  expect(
    (await readSubagentCapture()).slice(beforeCapture).filter((r) => r.path.includes("/messages")),
  ).toHaveLength(2);
}
