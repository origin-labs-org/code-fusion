import { afterEach, expect, test, vi } from "vitest";
import { models } from "$shared/testing/work-models";

const host = vi.hoisted(() => ({
  read: null as null | (() => Promise<unknown>),
  changed: null as null | (() => void),
}));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ workModels: () => host.read!() as never });
});
vi.mock("$shared/ipc/native-events", () => ({
  events: {
    workModelsChanged: {
      listen: (listener: () => void) => {
        host.changed = listener;
        return Promise.resolve(() => {
          host.changed = null;
        });
      },
    },
  },
}));

const { ModelsSession } = await import("../models.svelte");

const profile = "01J9ZQ3V6Q4M8Y2K7T5R1N0B3P";

afterEach(() => {
  host.read = null;
});

const answer = () => ({ ...models({ keys: { anthropic: "valid" } }), profile });

test("changes that arrive during a read are answered by one more read, not one each", async () => {
  let reads = 0;
  const gates: Array<() => void> = [];
  host.read = () => {
    reads += 1;
    return new Promise((resolve) => gates.push(() => resolve(answer())));
  };
  const session = new ModelsSession(profile);
  const started = session.start();
  await vi.waitFor(() => expect(reads).toBe(1));
  for (let burst = 0; burst < 6; burst += 1) host.changed?.();
  expect(reads).toBe(1);
  gates.shift()!();
  await vi.waitFor(() => expect(reads).toBe(2));
  gates.shift()!();
  await started;
  await vi.waitFor(() => expect(session.models).not.toBeNull());
  expect(reads).toBe(2);
  session.dispose();
});

test("an identical answer keeps the same object, so nothing downstream runs again", async () => {
  let reads = 0;
  host.read = () => {
    reads += 1;
    return Promise.resolve(answer());
  };
  const session = new ModelsSession(profile);
  await session.start();
  const first = session.models;
  host.changed?.();
  await vi.waitFor(() => expect(reads).toBe(2));
  expect(session.models).toBe(first);
  session.dispose();
});
