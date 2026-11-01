import { createToolSearchCliFixture } from "../helpers/toolsearch-cli-process.js";
import {
  isToolSearchCompact,
  TOOLSEARCH_CALL_ID,
  TOOLSEARCH_NOTICE,
} from "../helpers/toolsearch-provider.js";

describe("ToolSearch auto-compact and failure recovery (real CLI / HTTP)", () => {
  for (const trigger of ["auto", "reactive"] as const) {
    it(`TS09: Continue 期间 ${trigger} compact 重建One份公告并Retain发现`, async function () {
      this.timeout(120_000);
      const fixture = await createToolSearchCliFixture("conversation-session-toolsearch-compact");
      try {
        const seed = await fixture.start([
          "--toolsearch-mode",
          "native",
          "-p",
          "E2E_TOOLSEARCH_INITIAL Search and execute.",
        ]).done;
        expect(seed.code).toBe(0);
        const { sessionId } = JSON.parse(seed.stdout) as { sessionId: string };
        let mainCalls = 0;
        let summaries = 0;
        fixture.setResponse((body, response) => {
          if (isToolSearchCompact(body)) {
            summaries++;
            fixture.reply(body, response, "summary");
            return;
          }
          if (!body.tools?.length) {
            fixture.reply(body, response, "auxiliary");
            return;
          }
          mainCalls++;
          fixture.reply(
            body,
            response,
            mainCalls === 2 && trigger === "reactive"
              ? "context-error"
              : mainCalls === 1
                ? `partial-${trigger}`
                : "compact-done",
          );
        });
        const start = fixture.requests.length;
        const run = await fixture.start([
          "--toolsearch-mode",
          "native",
          "--resume",
          sessionId,
          "-p",
          "E2E_TOOLSEARCH_CONTINUE_COMPACT Continue.",
        ]).done;
        expect(run.code).toBe(0);
        expect(summaries).toBeGreaterThan(0);
        const main = fixture.requests
          .slice(start)
          .filter(({ body }) => body.tools?.length && !isToolSearchCompact(body));
        expect(main.length).toBeGreaterThanOrEqual(2);
        for (const { body } of main) {
          expect(JSON.stringify(body.messages).split(TOOLSEARCH_NOTICE)).toHaveLength(2);
          expect(body.tools?.find((tool) => tool.name === "TodoWrite")?.defer_loading).toBe(true);
        }
        expect(JSON.stringify(main.at(-1)!.body.messages)).toContain("E2E_TOOLSEARCH_SUMMARY");
      } finally {
        await fixture.close();
      }
    });
  }

  it("TS04: compact summary failure does not replace history; next cold request retains original references", async function () {
    this.timeout(120_000);
    const fixture = await createToolSearchCliFixture("conversation-session-toolsearch-compact");
    try {
      const seed = await fixture.start([
        "--toolsearch-mode",
        "native",
        "-p",
        "E2E_TOOLSEARCH_INITIAL Search.",
      ]).done;
      expect(seed.code).toBe(0);
      const { sessionId } = JSON.parse(seed.stdout) as { sessionId: string };
      let failedSummaries = 0;
      fixture.setResponse((body, response) => {
        if (isToolSearchCompact(body)) {
          failedSummaries++;
          fixture.reply(body, response, "summary-error");
        } else fixture.reply(body, response);
      });
      await fixture.start(["--toolsearch-mode", "native", "--resume", sessionId, "-p", "/compact"])
        .done;
      expect(failedSummaries).toBeGreaterThan(0);
      const start = fixture.requests.length;
      const cold = await fixture.start([
        "--toolsearch-mode",
        "native",
        "--resume",
        sessionId,
        "-p",
        "E2E_TOOLSEARCH_COLD Check history after failure.",
      ]).done;
      expect(cold.code).toBe(0);
      const first = fixture.requests
        .slice(start)
        .find(({ body }) => body.tools?.length && !isToolSearchCompact(body))!.body;
      expect(first.tools?.find((tool) => tool.name === "TodoWrite")?.defer_loading).toBe(true);
      expect(JSON.stringify(first.messages)).toContain(TOOLSEARCH_CALL_ID);
      expect(JSON.stringify(first.messages)).toContain(
        '"type":"tool_reference","tool_name":"TodoWrite"',
      );
      expect(JSON.stringify(first.messages).split(TOOLSEARCH_NOTICE)).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  });

  it("TS04: Cancellation during compact request does not commit candidate summary or newly discovered baseline", async function () {
    this.timeout(120_000);
    const fixture = await createToolSearchCliFixture("conversation-session-toolsearch-compact");
    try {
      const seed = await fixture.start([
        "--toolsearch-mode",
        "native",
        "-p",
        "E2E_TOOLSEARCH_INITIAL Search and prepare to cancel compact.",
      ]).done;
      expect(seed.code).toBe(0);
      const { sessionId } = JSON.parse(seed.stdout) as { sessionId: string };
      let summaryStarted = false;
      fixture.setResponse((body, response) => {
        if (isToolSearchCompact(body)) {
          summaryStarted = true;
          fixture.reply(body, response, "summary-partial", false);
        } else fixture.reply(body, response);
      });
      const compact = fixture.start([
        "--toolsearch-mode",
        "native",
        "--resume",
        sessionId,
        "-p",
        "/compact",
      ]);
      await browser.waitUntil(async () => summaryStarted, {
        timeout: 30_000,
        timeoutMsg: "compact 没有发起真实摘要请求",
      });
      compact.child.kill("SIGINT");
      await compact.done;
      const start = fixture.requests.length;
      const cold = await fixture.start([
        "--toolsearch-mode",
        "native",
        "--resume",
        sessionId,
        "-p",
        "E2E_TOOLSEARCH_COLD Check original history after cancellation.",
      ]).done;
      expect(cold.code).toBe(0);
      const first = fixture.requests
        .slice(start)
        .find(({ body }) => body.tools?.length && !isToolSearchCompact(body))!.body;
      expect(first.tools?.find((tool) => tool.name === "TodoWrite")?.defer_loading).toBe(true);
      const messages = JSON.stringify(first.messages);
      expect(messages).toContain(TOOLSEARCH_CALL_ID);
      expect(messages).toContain('"type":"tool_reference","tool_name":"TodoWrite"');
      expect(messages).not.toContain("E2E_TOOLSEARCH_UNCOMMITTED_SUMMARY");
      expect(messages.split(TOOLSEARCH_NOTICE)).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  });
});
