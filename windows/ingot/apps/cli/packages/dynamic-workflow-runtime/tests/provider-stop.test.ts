

import { describe, expect, it } from "vitest";
import { WorkflowError } from "@origin-ai/cf-dynamic-workflow";
import { runScript } from "./helpers.js";

const PROVIDER_STOP = new WorkflowError("ProviderStop", "Sign-in to BigModel expired.", {
  providerStop: {
    kind: "auth",
    reason: "auth_failed",
    providerId: "account:bigmodel-coding-plan",
    modelId: "GLM-5.3",
    providerCode: "1006",
    subagent: "ask#1@1",
    rawMessage: "[1006] token expired",
  },
});

describe("provider stop crossed boundary", () => {
  it("Script's try/catch cannot catch it: run stops as stopped(provider), sibling asks aborted", async () => {
    const script = [
      'const a = agent("a", "You do things.");',
      'const b = agent("b", "You do things.");',
      "try {",
      '  await Promise.all([a.ask("go"), b.ask("go")]);',
      "} catch (e) {",
      '  return "caught";',
      "}",
      'return "done";',
    ].join("\n");

    const { settlement, journal, driver } = await runScript(script, {
      asks: {
        "ask#1": () => ({ type: "stop-run", error: PROVIDER_STOP }),
        "ask#2": () => [],
      },
    });

    expect(settlement).toEqual({ status: "stopped", reason: "provider", error: PROVIDER_STOP });
    const run = journal.getRun("run");
    expect(run?.status).toBe("stopped");
    expect(run?.stopReason).toBe("provider");
    expect(run?.failure).toEqual(PROVIDER_STOP.toJSON());
    expect(driver.cancels.map((c) => c.siteId).sort()).toEqual(["ask#1", "ask#2"]);
    expect(journal.getNode("run", "ask#1", 1)?.status).toBe("running");
    expect(journal.getNode("run", "ask#2", 1)?.status).toBe("running");
    const settled = driver.eventsOfType("run-settled");
    expect(settled).toEqual([
      {
        type: "run-settled",
        status: "stopped",
        stopReason: "provider",
        error: PROVIDER_STOP.toJSON(),
      },
    ]);
  });
});
