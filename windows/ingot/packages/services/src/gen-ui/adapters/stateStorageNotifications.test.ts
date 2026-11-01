import { EventEmitter } from "node:events";
import {
  watch,
  type FSWatcher,
  type PathLike,
  type WatchListener,
  type WatchOptions,
} from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createGenUiStateStorage } from "#src/gen-ui/adapters/stateStorage.js";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, watch: vi.fn() };
});

class ControlledWatcher extends EventEmitter implements FSWatcher {
  close() {
    this.removeAllListeners();
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
}

it("broadcasts external state once despite duplicate file events and write acknowledgements", async () => {
  const watchers: ControlledWatcher[] = [];
  vi.mocked(watch).mockImplementation(
    (
      _path: PathLike,
      options: WatchOptions | WatchListener<string>,
      listener?: WatchListener<string>,
    ) => {
      const watcher = new ControlledWatcher();
      const onChange = typeof options === "function" ? options : listener;
      if (onChange) watcher.on("change", onChange);
      watchers.push(watcher);
      return watcher;
    },
  );
  const root = await mkdtemp(join(tmpdir(), "gen-ui-state-notifications-"));
  const a = createGenUiStateStorage(root);
  const b = createGenUiStateStorage(root);
  const target = {
    workspacePath: "/workspace",
    sessionId: "task",
    path: "/workspace/chart.html",
  };
  try {
    await a.get(target);
    await b.get(target);
    expect(watchers).toHaveLength(2);
    const receivedA = vi.fn();
    const receivedB = vi.fn();
    a.onChanged(receivedA);
    b.onChanged(receivedB);
    for (const [index, modelContent] of ["selection", "updated selection"].entries()) {
      const state = { modelContent, privateContent: null };
      const changed = new Promise<unknown>((resolve) => {
        const off = a.onChanged((event) => {
          off.dispose();
          resolve(event.state);
        });
      });
      await b.set(target, state);
      expect(await a.get(target)).toEqual(state);
      expect(receivedA).toHaveBeenCalledTimes(index);
      const [scopeDirectory] = await readdir(root);
      const [stateFile] = (await readdir(join(root, scopeDirectory!))).filter((name) =>
        name.endsWith(".json"),
      );
      expect(stateFile).toBeDefined();
      for (const watcher of watchers) {
        watcher.emit("change", "rename", stateFile);
        watcher.emit("change", "change", stateFile);
        watcher.emit("change", "rename", stateFile);
      }
      expect(await changed).toEqual(state);
      await Promise.all([a.set(target, state), b.set(target, state)]);
      for (const received of [receivedA, receivedB]) {
        expect(received).toHaveBeenCalledTimes(index + 1);
        expect(received).toHaveBeenLastCalledWith({ target, state });
      }
    }
  } finally {
    a.dispose();
    b.dispose();
    await rm(root, { recursive: true, force: true });
    vi.mocked(watch).mockReset();
  }
});
