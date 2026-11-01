import { beforeEach, describe, expect, it, vi } from "vitest";

const admit = vi.fn();
vi.mock("$shared/ipc/bindings", () => ({ commands: { mediaAdmitRemote: admit } }));
vi.mock("../lib/subjects", () => ({
  subjectsOf: () => [{ name: "one" }, { name: "two" }],
  subjectImageCandidates: () => ["https://cdn.example.com/a.jpg"],
}));
vi.mock("../lib/link-media", () => ({ pickCandidates: () => [], youtubeThumbnail: () => null }));

const { PictureQueue } = await import("../lib/workspace/pictures.svelte");

function subject(id: string, index: number) {
  return {
    id,
    reference: { kind: "subject", objective: "o", execution: "x", artifact: "a", index },
  };
}

function setup() {
  const snapshot = {
    id: "env",
    elements: [subject("s1", 0), subject("s2", 1)],
    relations: [] as { from: string; to: string; kind: string }[],
  };
  const edit = vi.fn(async (change: { from: string; to: string; kind: string }) => {
    snapshot.relations.push({ from: change.from, to: change.to, kind: "uses" });
    return true;
  });
  const queue = new PictureQueue({
    session: () => ({ profile: "p", snapshot, edit }) as never,
    media: () => new Map(),
    objectives: () =>
      new Map([["o", { executions: [{ id: "x", artifacts: [{ id: "a", data: {} }] }] }]]) as never,
  });
  return { snapshot, edit, queue };
}

describe("PictureQueue", () => {
  beforeEach(() => admit.mockReset());

  it("asks the backend once per picture and not again on later runs", async () => {
    const { snapshot, queue } = setup();
    admit.mockImplementation(async () => {
      snapshot.elements.push({ id: "m1", reference: { kind: "resource", resource: "r" } } as never);
      snapshot.relations.push({ from: "s1", to: "m1", kind: "uses" });
      return { status: "ok", data: { kind: "admitted", element: "m1" } };
    });
    await queue.run();
    await queue.run();
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it("relates a second subject to the element the backend already placed", async () => {
    const { snapshot, edit, queue } = setup();
    admit.mockImplementation(async () => {
      snapshot.elements.push({ id: "m1", reference: { kind: "resource", resource: "r" } } as never);
      snapshot.relations.push({ from: "s1", to: "m1", kind: "uses" });
      return { status: "ok", data: { kind: "admitted", element: "m1" } };
    });
    await queue.run();
    await queue.run();
    expect(admit).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledWith({
      kind: "relate",
      from: "s2",
      to: "m1",
      relation: "uses",
    });
  });
});
