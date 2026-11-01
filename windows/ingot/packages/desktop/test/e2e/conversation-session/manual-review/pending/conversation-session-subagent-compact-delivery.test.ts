import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveE2EStorageRoot } from "#e2e/helpers/e2e-runtime-paths";
import { releaseControlledReplay } from "#e2e/helpers/controlled-replay";
import {
  refreshSeededOpenAIProvidersThroughSettings,
  seedCustomAnthropicMessagesProvider,
} from "#e2e/helpers/custom-openai-provider";
import {
  getUpstreamRequestEvidence,
  getUpstreamRequestRecordCount,
  type UpstreamRequestEvidence,
} from "#e2e/helpers/conversation-session-network";
import { startConversationModelProviderReplayServer } from "#e2e/helpers/model-provider-replay";
import {
  clickV4Stop,
  getV4ComposerBackgroundWorkCounts,
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  sendV4Prompt,
  startNewV4Draft,
  switchV4Model,
  switchV4Mode,
  waitForV4AssistantMessageContaining,
  waitForV4CompactMarker,
  waitForV4Pane,
  waitForV4QueueCount,
} from "#e2e/helpers/v4-conversation";

const CASE_NAME = "conversation-session-subagent-compact-delivery";
const MODEL_ID = "e2e-subagent-delivery-model";
const PROVIDER_ID = "e2e-subagent-delivery-provider";
const CHILDREN = [1, 2] as const;
const TIMEOUT_MS = 180_000;
const ORDERS = [
  ["before", "before"],
  ["before", "during"],
  ["before", "after"],
  ["during", "during"],
  ["during", "after"],
  ["after", "after"],
  ["consumed", "consumed"],
] as const;
const SCENARIOS = [
  ...(["manual", "auto", "reactive"] as const).flatMap((trigger) =>
    (["completion", "reply"] as const).flatMap((kind) =>
      ORDERS.map((order) => ({ trigger, kind, order })),
    ),
  ),
  { trigger: "none", kind: "reply", order: ["during", "during"] } as const,
];
let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>>;

describe("BG46/BG47 Subagent Report-Back and Compaction Interleaving", () => {
  before(async function () {
    this.timeout(240_000);
    replay = await startConversationModelProviderReplayServer(CASE_NAME);
    await prepareV4ConversationE2E({ skipProvider: true });
    await seedCustomAnthropicMessagesProvider({
      baseURL: replay.baseUrl,
      modelId: MODEL_ID,
      providerId: PROVIDER_ID,
      providerName: "Subagent delivery E2E",
    });
    await refreshSeededOpenAIProvidersThroughSettings(["Subagent delivery E2E"]);
    await prepareV4ConversationE2E({ skipProvider: true });
  });

  after(async () => {
    await replay?.stop();
  });

  for (const { trigger, kind, order } of SCENARIOS) {
    const orderName = order.join("-");
    it(`${trigger === "none" ? "BG47" : "BG46"}: ${trigger} / ${kind} / ${orderName}`, async function () {
      this.timeout(TIMEOUT_MS);
      const scenario = `${trigger}-${kind}`;
      const marker = `E2E_SUBAGENT_DELIVERY_${scenario.toUpperCase().replaceAll("-", "_")}`;
      const results = CHILDREN.map((index) => `${marker}_RESULT_${index}`);
      const afterIndex = (await getUpstreamRequestRecordCount()) - 1;
      const evidence = () => getUpstreamRequestEvidence({ includes: [marker] }, { afterIndex });
      const waitStage = (stage: string, complete = false) =>
        waitForStage(`${scenario}-${stage}`, evidence, complete);
      const milestones: Array<{ event: string; at: string }> = [];
      let timingEvents: DeliveryTimingEvent[] = [];
      const note = (event: string) => milestones.push({ event, at: new Date().toISOString() });
      const released = new Set<number>();
      const waitCompactEvent = async (status: "started" | "completed") => {
        const sessionId = (await getV4PaneSnapshot()).sessionId!;
        await browser.waitUntil(
          async () =>
            (await readDeliveryTimingEvents(sessionId)).some((event) =>
              event.event.endsWith(`.${status}`),
            ),
          { timeout: 15_000, timeoutMsg: `Run时 compact ${status} Events缺失` },
        );
      };
      const deliver = async (phase: (typeof order)[number]) => {
        const children = CHILDREN.filter((index) => order[index - 1] === phase);
        if (children.length === 0) return;
        await Promise.all(
          children.map((index) => releaseControlledReplay(`${scenario}-child-${index}`)),
        );
        for (const index of children) {
          released.add(index);
          if (kind === "reply") {
            const continued = await waitStage(`child-${index}-continued`);
            expect(requestMessages(continued)).toContain("was queued for the coordinator");
          } else {
            await waitStage(`child-${index}`, true);
          }
          note(`child-${index}-${phase}-returned`);
        }
        if (kind === "completion") await waitForChildCount(CHILDREN.length - released.size);
      };
      const waitForResults = async (expected: readonly number[]) => {
        await browser.waitUntil(
          async () =>
            (await evidence()).some(
              (record) =>
                isParentDelivery(record, kind) &&
                record.status === "complete" &&
                expected.every((index) => requestMessages(record).includes(results[index - 1]!)),
            ),
          { timeout: 30_000, timeoutMsg: `父Model未消费Result ${expected.join(",")}` },
        );
      };
      try {
        await startNewV4Draft();
        await switchV4Model(PROVIDER_ID, MODEL_ID, "");
        await switchV4Mode("yolo");
        for (const index of CHILDREN) {
          await sendV4Prompt(`${marker}_SEED_${index}: Establish completed history.`);
          await waitForV4AssistantMessageContaining(`${marker}_SEEDED_${index}`);
          await waitForIdle();
        }
        await sendV4Prompt(
          `${marker}_LAUNCH: Start two background agents and await their results.`,
        );
        for (const index of CHILDREN) await waitStage(`child-${index}`);
        await waitForV4AssistantMessageContaining(`${marker}_LAUNCHED`);
        await waitForIdle();
        await waitForChildCount(CHILDREN.length);
        expect(
          JSON.stringify((await waitStage("launch-ack", true)).requestJson).match(
            /"run_in_background":true/gu,
          ),
        ).toHaveLength(CHILDREN.length);

        if (order[0] === "consumed") {
          await deliver("consumed");
          await waitForResults(CHILDREN);
          await waitForIdle();
          note("both-consumed-before-compact");
        }
        await sendV4Prompt(`${marker}_ARM: Hold the parent request before compaction.`);
        const arm = await waitStage("arm");
        expect(arm.status).toBe("pending");
        await deliver("before");
        if (order[0] === "before") {
          expect(
            (await evidence()).filter((record) => isParentDelivery(record, kind)),
          ).toHaveLength(0);
          expect((await waitStage("arm")).status).toBe("pending");
          note("returned-but-not-consumed");
        }
        if (trigger === "manual" || trigger === "auto") {
          await sendV4Prompt(trigger === "manual" ? "/compact" : `${marker}_TRIGGER: Continue.`);
          await waitForV4QueueCount(1, 15_000);
        }
        if (trigger === "none") {
          await deliver("during");
          expect((await waitStage("arm")).status).toBe("pending");
          await releaseControlledReplay(`${scenario}-arm`);
        } else {
          await releaseControlledReplay(`${scenario}-arm`);
          let compact: UpstreamRequestEvidence | undefined;
          await browser.waitUntil(
            async () => {
              compact = (await evidence()).find((record) =>
                record.fixtureId?.startsWith(`${scenario}-compact-`),
              );
              return Boolean(compact);
            },
            { timeout: 45_000, timeoutMsg: "Actual compact request not started" },
          );
          expect(compact!.status).toBe("pending");
          await waitCompactEvent("started");
          if (trigger !== "auto" || order[0] !== "before") {
            await waitForV4CompactMarker(
              { status: "running", origin: trigger === "manual" ? "manual" : "auto" },
              15_000,
            );
          }
          note("compact-running");
          for (const [offset, result] of results.entries()) {
            if (order[offset] === "during" || order[offset] === "after") {
              expect(requestMessages(compact!)).not.toContain(result);
            }
          }
          const requestsBeforeDuring = (await evidence()).filter((record) =>
            isParentDelivery(record, kind),
          ).length;
          await deliver("during");
          expect(
            (await evidence()).filter((record) => isParentDelivery(record, kind)),
          ).toHaveLength(requestsBeforeDuring);
          expect(
            (await evidence()).find((record) => record.fixtureId === compact!.fixtureId)?.status,
          ).toBe("pending");
          await releaseControlledReplay(compact!.fixtureId!);
          await waitCompactEvent("completed");
          if (trigger !== "auto" || order[0] !== "before") {
            await waitForV4CompactMarker(
              { status: "success", origin: trigger === "manual" ? "manual" : "auto" },
              15_000,
            );
          }
          note("compact-completed");
          await waitForIdle();
          await waitForV4QueueCount(0, 15_000);
          await deliver("after");
        }

        await browser.waitUntil(
          async () =>
            (await evidence()).some(
              (record) =>
                !isCompactRequest(record) &&
                isParentDelivery(record, kind) &&
                record.status === "complete" &&
                CHILDREN.every((index) => hasResult(record, marker, index)),
            ),
          { timeout: 30_000, timeoutMsg: "Both results did not enter the same parent request (raw text or summary)" },
        );
        await waitForIdle();
        await waitForV4QueueCount(0, 15_000);
        await sendV4Prompt(`${marker}_PROBE: Verify both child results after the handoff.`);
        const probe = await waitStage("probe", true);
        for (const index of CHILDREN) expect(hasResult(probe, marker, index)).toBe(true);
        if (order[0] === "consumed") {
          const compact = (await evidence()).find(isCompactRequest)!;
          for (const result of results) {
            if (!requestMessages(compact).includes(result)) {
              expect(requestMessages(probe)).toContain(result);
            }
          }
        }
        if (trigger !== "none") expect(requestMessages(probe)).toContain(`${marker}_SUMMARY`);
        await waitForV4AssistantMessageContaining(`${marker}_PROBED`);
        await waitForIdle();

        const sessionId = (await getV4PaneSnapshot()).sessionId!;
        const enqueueEvent =
          kind === "reply"
            ? "subagent.response.runtime_enqueued"
            : "background_task.notification.runtime_enqueued";
        await browser.waitUntil(
          async () => {
            timingEvents = await readDeliveryTimingEvents(sessionId);
            return (
              timingEvents.filter((event) => event.event === enqueueEvent).length === 2 &&
              (trigger === "none" ||
                timingEvents.some((event) => event.event.endsWith(".completed")))
            );
          },
          { timeout: 15_000, timeoutMsg: "Execution log lacks evidence of report-back enqueuing or compaction terminal state" },
        );
        const enqueued = timingEvents.filter((event) => event.event === enqueueEvent);
        expect(new Set(enqueued.map((event) => event.context?.commandId)).size).toBe(2);
        if (trigger !== "none") {
          const started = timingEvents.find((event) => event.event.endsWith(".started"))!.timestamp;
          const completed = timingEvents.find((event) =>
            event.event.endsWith(".completed"),
          )!.timestamp;
          for (const index of CHILDREN) {
            const event = enqueued.find(
              (item) => item.context?.parentToolCallId === `toolu_${scenario}_agent_${index}`,
            )!;
            expect(event).toBeDefined();
            const phase = order[index - 1];
            if (phase === "before" || phase === "consumed")
              expect(event.timestamp < started).toBe(true);
            if (phase === "during")
              expect(event.timestamp >= started && event.timestamp < completed).toBe(true);
            if (phase === "after") expect(event.timestamp >= completed).toBe(true);
          }
        }

        for (const record of (await evidence()).filter((item) => isParentDelivery(item, kind))) {
          for (const result of results)
            expect(requestMessages(record).split(result).length).toBeLessThanOrEqual(2);
        }
        if (kind === "reply") {
          await Promise.all(
            CHILDREN.map((index) =>
              releaseControlledReplay(`${scenario}-child-${index}-continued`),
            ),
          );
          await waitForChildCount(0);
          await browser.waitUntil(
            async () =>
              (await evidence()).some(
                (record) =>
                  record.fixtureId === `${scenario}-final-notice` &&
                  record.status === "complete" &&
                  CHILDREN.every((index) =>
                    requestMessages(record).includes(`${marker}_CHILD_FINAL_${index}`),
                  ),
              ),
            { timeout: 30_000, timeoutMsg: "After active reply, both child terminal states were not delivered to parent model" },
          );
          await waitForIdle();
        }
        const trajectory = await evidence();
        expect(trajectory.filter((record) => record.fixtureId === null)).toHaveLength(0);
        expect(trajectory.filter(isCompactRequest)).toHaveLength(trigger === "none" ? 0 : 1);
        if (trigger === "reactive") expect((await waitStage("arm", true)).statusCode).toBe(400);
      } finally {
        const artifactDir = process.env.CF_E2E_ARTIFACT_DIR;
        if (artifactDir) {
          await mkdir(join(artifactDir, "subagent-delivery"), { recursive: true });
          await writeFile(
            join(artifactDir, "subagent-delivery", `${scenario}-${orderName}.json`),
            JSON.stringify(
              {
                trigger,
                kind,
                order,
                milestones,
                timingEvents,
                records: await evidence(),
                pane: await getV4PaneSnapshot().catch(() => null),
                background: await getV4ComposerBackgroundWorkCounts().catch(() => null),
              },
              null,
              2,
            ),
          );
        }
        const response = await fetch(`${replay.baseUrl}/__e2e__/gates`);
        const gates = (await response.json()) as string[];
        for (const gate of gates.filter((id) => id.startsWith(scenario))) {
          await fetch(`${replay.baseUrl}/__e2e__/release/${encodeURIComponent(gate)}`, {
            method: "POST",
          });
        }
        if ((await getV4PaneSnapshot()).canStop) await clickV4Stop();
      }
    });
  }
});

function isCompactRequest(record: UpstreamRequestEvidence) {
  return record.fixtureId?.includes("-compact-") ?? false;
}

interface DeliveryTimingEvent {
  event: string;
  timestamp: string;
  sessionId?: string;
  context?: { parentSessionId?: string; parentToolCallId?: string; commandId?: string };
}

async function readDeliveryTimingEvents(sessionId: string): Promise<DeliveryTimingEvent[]> {
  const logDir = process.env.CF_LOG_DIR?.trim() || join(resolveE2EStorageRoot(), "cli", "log");
  const names = (await readdir(logDir)).filter((name) => name.endsWith(".jsonl"));
  const files = await Promise.all(names.map((name) => readFile(join(logDir, name), "utf8")));
  return files
    .flatMap((file) => file.split("\n").slice(0, -1))
    .filter((line) => line.includes(sessionId))
    .map((line) => JSON.parse(line) as DeliveryTimingEvent)
    .filter(
      (event) =>
        (event.sessionId === sessionId || event.context?.parentSessionId === sessionId) &&
        (/^compact(?:\.(?:auto|reactive))?\.(?:started|completed)$/u.test(event.event) ||
          event.event === "subagent.response.runtime_enqueued" ||
          event.event === "background_task.notification.runtime_enqueued"),
    );
}

function hasResult(record: UpstreamRequestEvidence, marker: string, index: number) {
  const text = requestMessages(record);
  return (
    text.includes(`${marker}_RESULT_${index}`) || text.includes(`${marker}_SUMMARIZED_${index}`)
  );
}

async function waitForStage(
  id: string,
  read: () => Promise<UpstreamRequestEvidence[]>,
  complete = false,
) {
  let found: UpstreamRequestEvidence | undefined;
  await browser.waitUntil(
    async () => {
      found = (await read()).find(
        (record) => record.fixtureId === id && (!complete || record.status === "complete"),
      );
      return Boolean(found);
    },
    {
      timeout: 45_000,
      interval: 100,
      timeoutMsg: `未到达 provider Phase ${id} complete=${complete}`,
    },
  );
  return found!;
}

function requestMessages(record: UpstreamRequestEvidence) {
  return JSON.stringify((record.requestJson as { messages?: unknown }).messages);
}

function isParentDelivery(record: UpstreamRequestEvidence, kind: "reply" | "completion") {
  const text = requestMessages(record);
  return (
    text.includes(kind === "reply" ? "<subagent-message>" : "<task-notification>") &&
    !text.includes("CRITICAL: Respond with TEXT ONLY")
  );
}

async function waitForIdle() {
  await waitForV4Pane((pane) => !pane.canStop, "父会话未恢复 idle", 45_000);
}

async function waitForChildCount(expected: number) {
  await browser.waitUntil(
    async () => ((await getV4ComposerBackgroundWorkCounts())?.subagentCount ?? 0) === expected,
    {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: `Running child Quantity未变为 ${expected}`,
    },
  );
}
