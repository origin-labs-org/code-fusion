import { describe, expect, it } from "vitest";
import { parseProvisioningSyncEvents } from "./e2e/helpers/provisioning-sync-evidence.js";

const context = {
  environmentKey: "env-a",
  trigger: "personal-config",
  status: "failed",
  durationMs: 14,
};
const warning = `[2026-09-25 00:10:00] [warn] [pid:123] [main] [provider-provisioning] Environment sync did not apply ${JSON.stringify(context)}`;

describe("Capture actual Main Provisioning results", () => {
  it("保留成功与失败两类事件，供提交数和返回数对账", () => {
    const completed = warning
      .replace("[warn]", "[info]")
      .replace("sync did not apply", "sync completed")
      .replace('"status":"failed"', '"status":"applied"');
    expect(parseProvisioningSyncEvents(`${completed}\n${warning}\n`)).toEqual([
      { kind: "completed", ...context, status: "applied" },
      { kind: "warning", ...context },
    ]);
  });

  it("Identify structured warnings without treating renderer paraphrases as Main execution results", () => {
    expect(
      parseProvisioningSyncEvents(`${warning}\n${warning.replace("[main]", "[renderer]")}\n`),
    ).toEqual([{ kind: "warning", ...context }]);
  });

  it("Reject evidence collection when completion logs contradict failure status; cannot pretend to be applied", () => {
    const wrong = warning
      .replace("[warn]", "[info]")
      .replace("sync did not apply", "sync completed");
    expect(() => parseProvisioningSyncEvents(`${wrong}\n`)).toThrow();
  });

  it("Ignore only the trailing line being appended; retain real events after complete write", () => {
    expect(parseProvisioningSyncEvents(warning)).toEqual([]);
    expect(parseProvisioningSyncEvents(`${warning}\n`)).toHaveLength(1);
  });

  it("Complete records lacking Environment identity must report an error", () => {
    expect(() =>
      parseProvisioningSyncEvents(`${warning.replace('"environmentKey":"env-a",', "")}\n`),
    ).toThrow();
  });
});
