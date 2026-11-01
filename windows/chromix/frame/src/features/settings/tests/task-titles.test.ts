import { afterEach, beforeEach, expect, test, vi } from "vitest";

const host = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ workCall: host.call });
});

let taskTitle: typeof import("../lib/task-titles").taskTitle;

beforeEach(async () => {
  vi.resetModules();
  host.call.mockReset();
  ({ taskTitle } = await import("../lib/task-titles"));
});
afterEach(() => vi.restoreAllMocks());

const projection = (objective: string, titles: Array<string | null>) => ({
  version: 1,
  profile: "p1",
  reply: {
    kind: "projection",
    projection: { work: { objective }, executions: titles.map((title) => ({ title })) },
  },
});

test("a task is named by the title its last finish gave it, else by what was asked", async () => {
  host.call.mockResolvedValueOnce(projection("Compare standing desks", ["First", null, "Latest"]));
  expect(await taskTitle("p1", "w1")).toBe("Latest");
  host.call.mockResolvedValueOnce(projection("  Compare\n standing   desks  ", [null]));
  expect(await taskTitle("p1", "w2")).toBe("Compare standing desks");
});

test("a long title is cut to a line, and the query asks for that task alone", async () => {
  host.call.mockResolvedValueOnce(projection("x".repeat(300), []));
  const title = await taskTitle("p1", "w3");
  expect(title).toHaveLength(80);
  expect(title!.endsWith("…")).toBe(true);
  expect(host.call).toHaveBeenCalledWith("p1", {
    kind: "query",
    request: { version: 1, query: { kind: "projection", work: "w3" } },
  });
});

test("a name is read once, and a read that fails is asked again next time", async () => {
  host.call.mockResolvedValueOnce(projection("Desks", []));
  expect(await taskTitle("p1", "w4")).toBe("Desks");
  expect(await taskTitle("p1", "w4")).toBe("Desks");
  expect(host.call).toHaveBeenCalledTimes(1);

  host.call.mockRejectedValueOnce(new Error("gone")).mockResolvedValueOnce(projection("Back", []));
  expect(await taskTitle("p1", "w5")).toBeNull();
  expect(await taskTitle("p1", "w5")).toBe("Back");
});

test("a task that is gone, or answered for another profile, has no name", async () => {
  host.call.mockResolvedValueOnce({ version: 1, profile: "p1", reply: { kind: "error" } });
  expect(await taskTitle("p1", "w6")).toBeNull();
  host.call.mockResolvedValueOnce(projection("Mine", []));
  expect(await taskTitle("p9", "w7")).toBeNull();
});

test("many tasks are read a few at a time, and each only once while asked together", async () => {
  let open = 0;
  let most = 0;
  host.call.mockImplementation(async () => {
    open += 1;
    most = Math.max(most, open);
    await new Promise((resolve) => setTimeout(resolve, 5));
    open -= 1;
    return projection("T", []);
  });
  const names = await Promise.all([
    ...Array.from({ length: 10 }, (_, n) => taskTitle("p1", `m${n}`)),
    taskTitle("p1", "m0"),
  ]);
  expect(names.every((name) => name === "T")).toBe(true);
  expect(host.call).toHaveBeenCalledTimes(10);
  expect(most).toBeLessThanOrEqual(3);
});
