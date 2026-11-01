import { expect, test, vi } from "vitest";
import type { WorkHumanCheckResponseV1 } from "$shared/ipc/bindings";
import { WorkHumanSession } from "../human.svelte";
const native = vi.hoisted(() => ({ check: vi.fn(), read: vi.fn() }));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ workHumanCheck: native.check, workHumanPages: native.read });
});
vi.mock("$shared/ipc/native-events", () => ({
  events: { workHumanChanged: { listen: async () => () => {} } },
}));
const page = { attempt: "attempt", step: "step", generation: 2 };
const response: WorkHumanCheckResponseV1 = {
  version: 1,
  profile: "profile",
  work: "work",
  page,
  outcome: "waiting",
};
async function session() {
  native.read.mockResolvedValue({
    version: 1,
    profile: "profile",
    work: "work",
    accepted: false,
    pages: [],
    error: null,
  });
  const session = new WorkHumanSession("profile");
  session.update(["work"]);
  await session.start();
  return session;
}
test("concurrent checks coalesce and wait for exact native identity", async () => {
  const current = await session();
  let settle: (response: WorkHumanCheckResponseV1) => void = () => {};
  native.check.mockImplementation(
    () =>
      new Promise((done) => {
        settle = done;
      }),
  );
  const first = current.check("work", page);
  expect(current.check("work", page)).toBe(first);
  await vi.waitFor(() => expect(native.check).toHaveBeenCalledWith("profile", "work", page));
  settle({ ...response, page: { ...page, generation: 1 } });
  expect(await first).toBe("unavailable");
  native.check.mockResolvedValue(response);
  expect(await current.check("work", page)).toBe("waiting");
  current.dispose();
});
test("disposed scope and transport refusal cannot produce a negative wall result", async () => {
  const current = await session();
  native.check.mockRejectedValueOnce(new Error("fixture transport"));
  expect(await current.check("work", page)).toBe("unavailable");
  let settle: (response: WorkHumanCheckResponseV1) => void = () => {};
  native.check.mockImplementation(
    () =>
      new Promise((done) => {
        settle = done;
      }),
  );
  const pending = current.check("work", page);
  await Promise.resolve();
  current.dispose();
  settle(response);
  expect(await pending).toBe("unavailable");
});
