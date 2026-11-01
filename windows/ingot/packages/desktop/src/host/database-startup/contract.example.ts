import { tasksStorageWorkerDataSchema } from "./contract.js";

export const exampleWorkerData = tasksStorageWorkerDataSchema.parse({
  path: "./tasks-index.sqlite",
});
