import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: "cua-placeholder",
    include: ["test/**/*.test.ts"],
    maxWorkers: 1,
    sequence: { groupOrder: 2 },
  },
});
