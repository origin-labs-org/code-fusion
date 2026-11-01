// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Emitter } from "@origin-ai/cf-rpc";
import { useWebRemoteControlAuthSync } from "@/web-remote-control/app/useWebRemoteControlAuthSync.js";

afterEach(cleanup);
it("初始恢复后转发凭据CompletedEvents，不依赖 UI Useror成功计Count更New；卸载Cancel订阅", () => {
  const session = new Emitter<"signed-in" | "signed-out">();
  const oauth = { onDidChangeSession: session.event };
  const notifyWebRemoteControlAuthStateChanged = vi.fn();
  const platform = { notifyWebRemoteControlAuthStateChanged };
  const { rerender, unmount } = renderHook(
    ({ userId, restoring }) => useWebRemoteControlAuthSync(platform, oauth, userId, restoring),
    {
      initialProps: { userId: "" as string | undefined, restoring: true },
    },
  );
  expect(notifyWebRemoteControlAuthStateChanged).not.toHaveBeenCalled();
  rerender({ userId: "user", restoring: false });
  session.fire("signed-out");
  session.fire("signed-in");
  session.fire("signed-in");
  rerender({ userId: undefined, restoring: false });
  unmount();
  session.fire("signed-out");
  expect(notifyWebRemoteControlAuthStateChanged.mock.calls).toEqual([
    [{ state: "signed-in" }],
    [{ state: "signed-out" }],
    [{ state: "signed-in" }],
    [{ state: "signed-in" }],
  ]);
});

it("没有Desktop平台通知Capabilities时不订阅远端 OAuth Events", () => {
  const onDidChangeSession = vi.fn();
  renderHook(() => useWebRemoteControlAuthSync({}, { onDidChangeSession }, "user", false));
  expect(onDidChangeSession).not.toHaveBeenCalled();
});
