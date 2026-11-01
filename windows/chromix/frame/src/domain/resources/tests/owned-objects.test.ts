import { beforeEach, expect, test, vi } from "vitest";
import type { ResourceRecord_Serialize as ResourceRecord } from "$shared/ipc/bindings";
const mocks = vi.hoisted(() => ({ call: vi.fn(), listen: vi.fn(), stop: vi.fn() }));
vi.mock("../transport", () => ({ resourceCall: mocks.call }));
vi.mock("$shared/ipc/native-events", () => ({
  events: { resourceChanged: { listen: mocks.listen } },
}));
import { OwnedObjects } from "../owned-objects";

const record = (revision = "1", done = false): ResourceRecord => ({
  id: "block",
  revision,
  created_at: "1",
  updated_at: revision,
  trashed: false,
  draft: {
    title: "Checklist",
    pinned: false,
    related: [],
    content: {
      kind: "object",
      object: {
        version: 1,
        evidence: [],
        data: { kind: "list", style: "todo", items: [{ title: "Passport", done }] },
      },
    },
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listen.mockResolvedValue(mocks.stop);
});

test("a conflict preserves the draft and never overwrites a newer record", async () => {
  mocks.call.mockResolvedValueOnce({ kind: "record", record: record() });
  const owned = new OwnedObjects("profile");
  await owned.load(["block"]);
  await vi.waitFor(() => expect(owned.get("block")?.revision).toBe("1"));
  owned.update("block", {
    kind: "list",
    style: "todo",
    items: [{ title: "Passport", done: true }],
  });
  expect(owned.revisions().has("block")).toBe(false);
  mocks.call.mockResolvedValue({ kind: "error", error: "conflict" });
  expect(await owned.flushAll()).toBe(false);
  expect(mocks.call.mock.calls.filter(([, call]) => call.kind === "mutate")).toHaveLength(1);
  expect(owned.get("block")?.data).toMatchObject({ items: [{ done: true }] });
  expect(owned.get("block")?.revision).toBe("1");
});

test("authoritative block events refresh the record and stale events cannot regress it", async () => {
  mocks.call.mockResolvedValue({ kind: "record", record: record() });
  const owned = new OwnedObjects("profile");
  await owned.start();
  await owned.load(["block"]);
  await vi.waitFor(() => expect(owned.get("block")?.revision).toBe("1"));
  const notify = mocks.listen.mock.calls[0]![0];
  mocks.call.mockResolvedValue({ kind: "record", record: record("3", true) });
  notify({ payload: { profile: "profile", kind: "object", id: "block", revision: "3" } });
  await vi.waitFor(() => expect(owned.get("block")?.revision).toBe("3"));
  mocks.call.mockResolvedValue({ kind: "record", record: record("2", false) });
  notify({ payload: { profile: "profile", kind: "object", id: "block", revision: "2" } });
  await Promise.resolve();
  await Promise.resolve();
  expect(owned.get("block")?.revision).toBe("3");
  owned.stop();
  expect(mocks.stop).toHaveBeenCalledOnce();
});
