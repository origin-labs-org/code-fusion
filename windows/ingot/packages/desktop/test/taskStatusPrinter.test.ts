import { describe, expect, it, vi } from "vitest";

const { oraMock } = vi.hoisted(() => ({
  oraMock: vi.fn(),
}));

vi.mock("ora", () => ({
  default: oraMock,
}));

import { createStatusPrinter } from "../../../scripts/release-it/task-status-printer.mjs";

describe("createStatusPrinter", () => {
  it("Output only task name and status", () => {
    const api = {
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    };
    oraMock.mockReturnValue(api);

    const printer = createStatusPrinter("改写 changelog");
    printer.start("开始");
    printer.succeed("完成");
    printer.fail("失败");

    expect(oraMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isEnabled: true,
        stream: process.stderr,
      }),
    );
    expect(api.start).toHaveBeenCalledWith("Changelog rewrite started");
    expect(api.succeed).toHaveBeenCalledWith("Changelog rewrite completed");
    expect(api.fail).toHaveBeenCalledWith("Changelog rewrite failed");
  });
});
