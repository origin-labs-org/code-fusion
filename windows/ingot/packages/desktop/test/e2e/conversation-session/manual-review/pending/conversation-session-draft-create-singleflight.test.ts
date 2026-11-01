import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { TID_V4_COMPOSER_SEND, TID_V4_SESSION_PANE, testId } from "@origin-ai/cf-shared/test-ids";
import {
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  sendV4Prompt,
  setV4ComposerText,
  startNewV4Draft,
  V4_MAIN_PANE_ID,
  waitForV4Pane,
  waitForV4TimelineContaining,
  waitForV4ComposerText,
} from "../../../helpers/v4-conversation.js";

interface CreateGate {
  commands: Array<{ type: string; sessionId: string | null }>;
  release(): void;
  restore(): void;
}

declare global {
  interface Window {
    __draftCreateGate?: CreateGate;
  }
}

describe("A01 草稿首发与预热共享一次创建", () => {
  afterEach(async () => {
    await browser.execute(() => window.__draftCreateGate?.restore());
  });

  it("Click send while warmup creation is in-flight, ultimately promoting only the same session", async function () {
    this.timeout(150_000);
    await prepareV4ConversationE2E();
    await sendV4Prompt("E2E_DRAFT_SINGLEFLIGHT_SETUP reply briefly");
    await waitForV4TimelineContaining("draft-singleflight-ok", 45_000);
    await waitForV4Pane((pane) => !pane.canStop && pane.sessionId !== "draft", "前置任务未完成");

    await browser.execute(() => {
      const original = MessagePort.prototype.postMessage;
      const held: Array<() => void> = [];
      let holding = true;
      const gate: CreateGate = {
        commands: [],
        release() {
          holding = false;
          held.splice(0).forEach((send) => send());
        },
        restore() {
          gate.release();
          MessagePort.prototype.postMessage = original;
          delete window.__draftCreateGate;
        },
      };
      MessagePort.prototype.postMessage = function (
        this: MessagePort,
        ...args: [unknown, (Transferable[] | StructuredSerializeOptions)?]
      ) {
        const forward = () => Reflect.apply(original, this, args);
        const data: unknown = args[0];
        const bytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : ArrayBuffer.isView(data)
              ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
              : null;
        const wire = bytes ? new TextDecoder().decode(bytes) : "";
        const type = wire.match(/"type":"(createSession|sendText)"/)?.[1];
        if (wire.includes("sendConversationCommandV4") && type) {
          gate.commands.push({ type, sessionId: wire.match(/"sessionId":"([^"]+)"/)?.[1] ?? null });
          if (type === "createSession" && holding) {
            held.push(forward);
            return;
          }
        }
        forward();
      };
      window.__draftCreateGate = gate;
    });
    await startNewV4Draft();
    await browser.waitUntil(
      () => browser.execute(() => Boolean(window.__draftCreateGate?.commands.length)),
      { timeout: 15_000, timeoutMsg: "Draft warmup createSession not intercepted" },
    );
    await sendV4Prompt("E2E_DRAFT_SINGLEFLIGHT_FIRST reply briefly");
    const pending = await browser.execute(
      (paneId, sendId) => ({
        commands: window.__draftCreateGate!.commands,
        sending: document.querySelector<HTMLButtonElement>(
          `[data-testid="${paneId}"] [data-testid="${sendId}"]`,
        )?.disabled,
      }),
      testId(TID_V4_SESSION_PANE, V4_MAIN_PANE_ID),
      TID_V4_COMPOSER_SEND,
    );
    expect(pending.sending).toBe(true);
    expect(pending.commands).toEqual([{ type: "createSession", sessionId: null }]);
    expect((await getV4PaneSnapshot()).sessionId).toBe("draft");
    await setV4ComposerText("E2E_PD08_NEXT_INPUT");

    await browser.execute(() => window.__draftCreateGate!.release());
    await waitForV4TimelineContaining("draft-singleflight-ok", 45_000);
    const pane = await waitForV4Pane(
      (value) => value.sessionId !== "draft" && value.sessionId !== null && !value.canStop,
      "First send did not enter completed details page",
    );
    const commands = await browser.execute(() => window.__draftCreateGate!.commands);
    expect(commands).toEqual([
      { type: "createSession", sessionId: null },
      { type: "sendText", sessionId: pane.sessionId },
    ]);
    expect(pane.timelineText).toContain("E2E_DRAFT_SINGLEFLIGHT_FIRST");
    await waitForV4ComposerText("E2E_PD08_NEXT_INPUT", "First send handoff lost next body text");
    await writeFile(
      join(process.env.CF_E2E_ARTIFACT_DIR!, "draft-create-commands.json"),
      JSON.stringify({ pending, commands, pane }, null, 2),
    );
    await browser.saveScreenshot(join(process.env.CF_E2E_ARTIFACT_DIR!, "draft-first-send.png"));
  });
});
