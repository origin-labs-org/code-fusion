import { describe, expect, it, vi } from "vitest";

const WRITTEN: string[] = [];

async function makeGlobals(bridgeOverrides: Record<string, unknown> = {}) {
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const clientUrl = fileURLToPath(new URL("../../cf-cua-plugin/scripts/computer-use-client.mjs", import.meta.url));
  const documentationRoot = join(dirname(clientUrl), "..", "docs");
  const bridge = {
    call: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
    assertAvailable: () => {},
    documentationRoot,
    ...bridgeOverrides,
  };
  const globals = {
    [Symbol.for("cf.node-repl.computer-use-bridge")]: bridge,
    nodeRepl: { write: (text: string) => { WRITTEN.push(text); } },
  };
  const mod = await import(clientUrl);
  await mod.setupComputerUseRuntime({ globals });
  return { globals, bridge, mod };
}

const referenceOf = (writes: readonly string[]) =>
  writes.find((text) => text.startsWith("# Computer Use"));

describe("computer-use output policy", () => {
  it("never pushes the reference, on the first call or any later one", async () => {
    WRITTEN.length = 0;
    const { globals } = await makeGlobals();
    await globals.agent.computerUse.computer.list_apps({});
    expect(referenceOf(WRITTEN)).toBeUndefined();
    await globals.agent.computerUse.computer.list_apps({});
    expect(referenceOf(WRITTEN)).toBeUndefined();
  });

  it("serves the reference through agent.documentation for the model to write", async () => {
    const { globals } = await makeGlobals();
    const doc = await (
      globals.agent as { documentation: { get: (name: string) => Promise<string> } }
    ).documentation.get("computer-use");
    expect(doc).toMatch(/^# Computer Use/u);
    expect(doc).toMatch(/## Tool arguments/u);
  });
});
