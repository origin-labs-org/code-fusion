import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildNodeReplHostBundle } from "../scripts/build.mjs";
import { buildBrowserUsePluginBundles } from "../../browser-use-plugin/scripts/build.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const buildTimeoutMs = 120_000;

type ProbeResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

const runBundleProbe = (bundlePath: string): Promise<ProbeResult> => {
  const probeSource = [
    `const bundle = await import(${JSON.stringify(pathToFileURL(bundlePath).href)});`,
    "process.stdout.write(typeof bundle.main);",
  ].join("\n");

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", probeSource], {
      cwd: packageRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", rejectPromise);
    child.once("close", (exitCode) => {
      resolvePromise({ exitCode, stderr, stdout });
    });
  });
};

describe("node_repl host and browser-use runtime bundles", () => {
  let outputDirectory = "";
  let mcpOutfile = "";
  let browserClientOutfile = "";

  beforeAll(async () => {
    outputDirectory = await mkdtemp(join(tmpdir(), "cf-node-repl-bundle-"));
    const [host, browser] = await Promise.all([
      buildNodeReplHostBundle({ outfile: join(outputDirectory, "mcp", "server.mjs") }),
      buildBrowserUsePluginBundles({
        browserClientOutfile: join(outputDirectory, "browser-client.mjs"),
      }),
    ]);
    mcpOutfile = host.outfile;
    browserClientOutfile = browser.browserClientOutfile;
  }, buildTimeoutMs);

  afterAll(async () => {
    if (outputDirectory) {
      await rm(outputDirectory, { force: true, recursive: true });
    }
  });

  it(
    "imports the built node_repl MCP server bundle without failing module evaluation",
    async () => {
      const probe = await runBundleProbe(mcpOutfile);

      expect(probe.stderr).not.toContain("Dynamic require of");
      expect({ exitCode: probe.exitCode, stderr: probe.stderr }).toEqual({
        exitCode: 0,
        stderr: "",
      });
      expect(probe.stdout).toBe("function");
    },
    buildTimeoutMs,
  );

  it(
    "negotiates MCP 2026-07-28 and isolates globals plus module cache in built node_repl",
    async () => {
      const transport = new StdioClientTransport({
        args: [mcpOutfile],
        command: process.execPath,
        cwd: packageRoot,
        stderr: "pipe",
      });
      const client = new Client(
        { name: "node-repl-bundle-smoke", version: "0.1.0" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } },
      );
      let serverStderr = "";
      transport.stderr?.setEncoding("utf8");
      transport.stderr?.on("data", (chunk: string) => {
        serverStderr += chunk;
      });
      try {
        await client.connect(transport).catch(async (error) => {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nbundle: ${mcpOutfile}\nserver stderr:\n${serverStderr}`,
          );
        });
        const listed = await client.listTools();
        expect(client.getProtocolEra()).toBe("modern");
        expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
        expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["js"]);
        const meta = {
          "com.cf/request-context": {
            runtime_scope: "main",
            session_id: "bundle-session",
          },
        };
        const first = await client.callTool({
          name: "js",
          arguments: {
            code: [
              "globalThis.__cfKernelMarker = 'FIRST';",
              "require('node:events').__cfModuleMarker = 'FIRST';",
              "'set';",
            ].join("\n"),
          },
          _meta: meta,
        });
        expect(first.isError).not.toBe(true);
        const second = await client.callTool({
          name: "js",
          arguments: {
            code: "({ kernel: typeof globalThis.__cfKernelMarker, module: typeof require('node:events').__cfModuleMarker });",
          },
          _meta: meta,
        });
        expect(second.content).toContainEqual(
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining('"kernel": "undefined"'),
          }),
        );
        expect(second.content).toContainEqual(
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining('"module": "undefined"'),
          }),
        );
        expect(serverStderr).toBe("");
      } finally {
        await client.close();
      }
    },
    buildTimeoutMs,
  );

  it("guards its CLI entry with pathToFileURL so Windows actually builds", async () => {
    const source = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
    expect(source).toContain("pathToFileURL");
    const codeLines = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(codeLines).not.toMatch(/file:\/\/\$\{process\.argv/u);
  });

  it("injects a real require into both ESM bundles so bundled CJS dependencies keep working", async () => {
    const [mcpBundle, browserClientBundle] = await Promise.all([
      readFile(mcpOutfile, "utf8"),
      readFile(browserClientOutfile, "utf8"),
    ]);

    for (const bundle of [mcpBundle, browserClientBundle]) {
      expect(bundle).toContain('createRequire as __cfCreateRequire } from "node:module"');
    }
  });

  it(
    "allows a development bundle with an empty helper build id",
    async () => {
      const outfile = join(outputDirectory, "mcp", "server.guard.mjs");
      const devResult = await buildNodeReplHostBundle({ outfile, cuaHelperBuildId: "" });
      expect(devResult.cuaHelperBuildId).toBe("");
    },
    buildTimeoutMs,
  );
});
