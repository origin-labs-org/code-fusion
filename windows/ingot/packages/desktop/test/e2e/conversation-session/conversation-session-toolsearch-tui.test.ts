import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createToolSearchCliFixture } from "../helpers/toolsearch-cli-process.js";
import { startToolSearchTerminal } from "../helpers/toolsearch-terminal.js";
import {
  TOOLSEARCH_NOTICE,
  TOOLSEARCH_DONE,
  toolSearchResponseStage,
  type ToolSearchRequest,
} from "../helpers/toolsearch-provider.js";

describe("ToolSearch TUI 真实终端", () => {
  it("TS02-TUI: Force-enable search, resume disabled by default, continue re-enables and restores real references", async function () {
    this.timeout(180_000);
    const fixture = await createToolSearchCliFixture("conversation-session-toolsearch-tui");
    let terminal: ReturnType<typeof startToolSearchTerminal> | undefined;
    const typeAndPaint = async (keys: string) => {
      const before = terminal!.frameCount();
      terminal!.write(keys);
      await browser.waitUntil(async () => terminal!.frameCount() > before, {
        timeout: 10_000,
        timeoutMsg: "TUI did not draw a new frame after keystroke",
      });
    };
    const submit = async (value: string) => {
      const before = terminal!.output().length;
      terminal!.write(`\x1b[200~${value}\x1b[201~`);
      await browser.waitUntil(async () => terminal!.output().slice(before).includes(value), {
        timeout: 10_000,
        timeoutMsg: "TUI has not drawn the current input yet",
      });
      terminal!.write("\r");
    };
    const turn = async (args: string[], marker: string) => {
      const before = fixture.requests.length;
      const completed = `${TOOLSEARCH_DONE}_${marker}`;
      fixture.setResponse((body, response) => {
        const stage = toolSearchResponseStage(body);
        fixture.reply(
          body,
          response,
          stage === "done" ? `done-${marker.split("_").at(-1)!.toLowerCase()}` : stage,
        );
      });
      terminal = startToolSearchTerminal(fixture, args);
      await browser.waitUntil(async () => terminal!.ready(), {
        timeout: 30_000,
        timeoutMsg: "TUI did not complete the initial terminal frame draw",
      });
      const beforeModel = terminal.output().length;
      await submit("/model toolsearch-process/test-toolsearch");
      await browser.waitUntil(
        async () => {
          const rendered = terminal!.output().slice(beforeModel);
          return rendered.includes("Model switched to toolsearch-process/test-toolsearch");
        },
        {
          timeout: 15_000,
          timeoutMsg: "TUI 未切换到隔离的普通 Anthropic provider",
        },
      );
      const beforeEffort = terminal.output().length;
      await submit("/effort disabled");
      await browser.waitUntil(
        async () => {
          const rendered = terminal!.output().slice(beforeEffort);
          return rendered.includes("Reasoning effort switched to disabled");
        },
        { timeout: 15_000, timeoutMsg: "TUI did not confirm test model thinking level" },
      );
      await submit(marker);
      await browser.waitUntil(async () => terminal!.output().includes(completed), {
        timeout: 30_000,
        timeoutMsg: "TUI 没有显示模型完成文本",
      });
      await typeAndPaint("\x03");
      terminal.write("\x03");
      expect(await terminal.done).toBe(0);
      await terminal.close();
      terminal = undefined;
      return fixture.requests
        .slice(before)
        .filter(({ body }) => body.tools?.length)
        .map(({ body }) => body);
    };
    const loaded = (body: ToolSearchRequest) => {
      expect(body.tools?.find((tool) => tool.name === "TodoWrite")?.defer_loading).toBe(true);
      expect(JSON.stringify(body.messages)).toContain(
        '"type":"tool_reference","tool_name":"TodoWrite"',
      );
      expect(JSON.stringify(body.messages).split(TOOLSEARCH_NOTICE)).toHaveLength(2);
    };
    try {
      await mkdir(join(fixture.root, ".cf", "v2"), { recursive: true });
      await writeFile(
        join(fixture.root, ".cf", "v2", "credentials.json"),
        JSON.stringify({
          "account-provider:account:zai-individual-coding-plan:identity": "toolsearch-e2e",
          "account-provider:coding-plan:account:zai-individual-coding-plan:account:toolsearch-e2e:api-key":
            "test-only",
        }),
      );
      const initial = await turn(["--toolsearch-mode", "native"], "E2E_TOOLSEARCH_INITIAL");
      expect(initial).toHaveLength(3);
      expect(initial[0]!.tools?.some((tool) => tool.name === "TodoWrite")).toBe(false);
      loaded(initial[1]!);
      const db = new DatabaseSync(join(fixture.root, "session.sqlite"), { readOnly: true });
      let sessionId: string;
      try {
        sessionId = (
          db.prepare("SELECT id FROM session ORDER BY time_created DESC LIMIT 1").get() as {
            id: string;
          }
        ).id;
      } finally {
        db.close();
      }
      const off = await turn(["--resume", sessionId], "E2E_TOOLSEARCH_OFF");
      expect(off).toHaveLength(1);
      expect(off[0]!.tools?.some((tool) => tool.name === "TodoWrite")).toBe(true);
      expect(off[0]!.tools?.some((tool) => tool.name === "ToolSearch" || tool.defer_loading)).toBe(
        false,
      );
      expect(JSON.stringify(off[0]!.messages)).not.toContain("tool_reference");
      expect(JSON.stringify(off[0]!.messages)).not.toContain(TOOLSEARCH_NOTICE);
      const on = await turn(["--toolsearch-mode", "native", "--continue"], "E2E_TOOLSEARCH_ON");
      expect(on).toHaveLength(1);
      loaded(on[0]!);
    } finally {
      await terminal?.close();
      await fixture.close();
    }
  });
});
