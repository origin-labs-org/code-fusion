import { describe, expect, it, vi } from "vitest";
import {
  bumpTaskListMembershipVersion,
  getTaskListMembershipVersion,
  subscribeTaskListMembershipVersion,
} from "@/v4/taskListMembershipVersion.js";

describe("taskListMembershipVersion", () => {
  it("Increment version after bump and notify subscribers", () => {
    const before = getTaskListMembershipVersion();
    const listener = vi.fn();
    const unsubscribe = subscribeTaskListMembershipVersion(listener);
    bumpTaskListMembershipVersion();
    expect(getTaskListMembershipVersion()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    bumpTaskListMembershipVersion();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
