import { expect, test } from "vitest";
import type { WorkExecutionFact } from "$shared/ipc/bindings";
import { runParts } from "../lib/run/parts";

const TITLES = { search: "Search", unread: "Couldn’t open", computer: "This Mac" };

function slackRun(decision: "approved" | "declined"): WorkExecutionFact {
  return {
    id: "run",
    spec: {},
    status: "failed",
    attempts: [],
    artifacts: [],
    provider_evidence: [],
    user_artifacts: [],
    steps: [
      {
        id: "send",
        turn: 1,
        part: "post",
        status: "succeeded",
        kind: {
          kind: "confirm",
          confirm: {
            site: "slack.com",
            category: "communication",
            headline: "Post to #social",
            action: "Send",
            decision,
          },
        },
      },
    ],
    parts: [
      {
        id: "post",
        title: "Slack post",
        helper: "browser",
        state: "failed",
        service: { host: "slack.com" },
        need: { kind: "retry", host: "slack.com", reason: "couldnt_read" },
      },
    ],
  } as unknown as WorkExecutionFact;
}

test("a part whose approved send ran never offers Try again", () => {
  const [part] = runParts("card", [slackRun("approved")], [], () => false, TITLES);
  expect(part?.need).toBeUndefined();
  expect(part?.summary).toContain("couldn’t be read back");
});

test("a declined send still offers Try again", () => {
  const [part] = runParts("card", [slackRun("declined")], [], () => false, TITLES);
  expect(part?.need?.kind).toBe("retry");
});
