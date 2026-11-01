import { describe, expect, it } from "vitest";
import { createRemoteConnectionProgressContext } from "@origin-ai/cf-server/remote/remoteConnectionProgressContext.js";

describe("remoteConnectionProgressContext", () => {
  it("Output only explicit text, sanitizing paths, credentials, and device identifiers", async () => {
    const events: unknown[] = [];
    const context = createRemoteConnectionProgressContext({
      emit: (event) => events.push(event.args),
    });
    await context.run("request", async () => {
      context.report("info", [{ settings: { workspacePath: "/Users/alice/private" } }]);
      context.report("info", [
        "upload /Users/alice/private/archive.tar C:\\Users\\alice\\key token=secret credentialRef=credential-123 deviceId=dev-123 3cd4f9da-cd79-426c-9d70-75f36e9f6a87",
      ]);
    });
    expect(events).toHaveLength(1);
    const output = JSON.stringify(events);
    for (const value of [
      "settings",
      "/Users/",
      "alice",
      "secret",
      "credential-123",
      "dev-123",
      "3cd4f9da",
    ])
      expect(output).not.toContain(value);
    expect(output).toContain("upload");
  });
  it("Absolute paths containing spaces must not remain in user logs either", async () => {
    const messages: string[] = [];
    const context = createRemoteConnectionProgressContext({ emit: (event) => messages.push(String(event.args[0])) });
    await context.run("request", async () => context.report("info", [String.raw`upload "/Users/Alice Smith/private file.tar" and "C:\Program Files\CodeFusion\key"`]));
    expect(messages.join("")).not.toMatch(/Alice|Smith|Program|Files|private file/);
  });

  it("Concurrent remote connections isolate progress by requestId; stop reporting residual async logs after connection ends", async () => {
    const events: Array<{ requestId: string; message: string }> = [];
    const context = createRemoteConnectionProgressContext({
      emit: (event) => events.push({ requestId: event.requestId, message: String(event.args[0]) }),
    });
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const first = context.run("connect-first", async () => {
      context.report("info", ["first-start"]);
      await firstGate;
      context.report("info", ["first-end"]);
      setTimeout(() => context.report("info", ["first-stale"]), 0);
    });
    const second = context.run("connect-second", async () => {
      context.report("info", ["second-start"]);
      await secondGate;
      context.report("info", ["second-end"]);
    });

    releaseSecond();
    await second;
    releaseFirst();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toEqual([
      { requestId: "connect-first", message: "first-start" },
      { requestId: "connect-second", message: "second-start" },
      { requestId: "connect-second", message: "second-end" },
      { requestId: "connect-first", message: "first-end" },
    ]);
  });
});
