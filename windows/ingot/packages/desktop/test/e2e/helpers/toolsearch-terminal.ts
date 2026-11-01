import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { pathToFileURL } from "node:url";
import { spawn } from "node-pty";
import type { createToolSearchCliFixture } from "./toolsearch-cli-process.js";

export function startToolSearchTerminal(
  fixture: Awaited<ReturnType<typeof createToolSearchCliFixture>>,
  args: string[],
) {
  const tsx = pathToFileURL(createRequire(join(process.cwd(), "package.json")).resolve("tsx")).href;
  const terminal = spawn(
    process.execPath,
    ["--import", tsx, fixture.cliPath, "tui", ...args, "--no-browser", "--locale", "en-US"],
    {
      name: "xterm-256color",
      useConptyDll: process.platform === "win32",
      cols: 140,
      rows: 40,
      cwd: fixture.workspace,
      env: { ...fixture.env, TERM: "xterm-256color" },
    },
  );
  let output = "";
  let exited = false;
  terminal.onData((data) => {
    output += data;
  });
  const done = new Promise<number>((resolve) =>
    terminal.onExit(({ exitCode }) => {
      exited = true;
      resolve(exitCode);
    }),
  );
  return {
    done,
    output: () => stripVTControlCharacters(output),
    ready: () => stripVTControlCharacters(output).includes("Type a prompt"),
    frameCount: () => output.split("\x1b[?2026l").length - 1,
    write: (text: string) => terminal.write(text),
    async close() {
      if (!exited) terminal.kill();
      await done;
      const capture = process.env.E2E_PROVIDER_CAPTURE_PATH;
      if (capture) await writeFile(`${capture}.pty-${terminal.pid}.txt`, output);
    },
  };
}
