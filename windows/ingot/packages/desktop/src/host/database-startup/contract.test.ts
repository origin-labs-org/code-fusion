import { expect, it } from "vitest";
import { tasksStorageWorkerDataSchema, workerMessageSchema } from "./contract.js";
import { exampleWorkerData } from "./contract.example.js";
it("Empty paths and unconventional inputs are rejected; progress lacking migration phase is not accepted", () => {
  expect(tasksStorageWorkerDataSchema.parse(exampleWorkerData)).toEqual(exampleWorkerData);
  expect(tasksStorageWorkerDataSchema.safeParse({ path: "" }).success).toBe(false);
  expect(tasksStorageWorkerDataSchema.safeParse({ path: "./db", hostId: "other" }).success).toBe(
    false,
  );
  expect(workerMessageSchema.safeParse({ type: "progress" }).success).toBe(false);
  expect(workerMessageSchema.parse({ type: "progress", phase: "maintaining" })).toEqual({
    type: "progress",
    phase: "maintaining",
  });
  expect(workerMessageSchema.parse({ type: "done" })).toEqual({ type: "done" });
});
