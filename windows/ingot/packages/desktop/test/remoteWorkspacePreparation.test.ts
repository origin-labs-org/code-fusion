import { chmod, mkdtemp, mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { IFileService } from "@origin-ai/cf-services";
import { createFileService } from "@origin-ai/cf-services/node";
import { prepareRemoteWorkspaceIdentity } from "@desktop/host/remoteWorkspacePreparation.js";
import { createWindowRemoteConnectionRegistry } from "@desktop/host/windowRemoteConnectionRegistry.js";

const unavailableCode = "remote-workspace-directory-unavailable";
const target = { kind: "ssh" as const, host: "fixture.invalid", username: "tester" };
const fileService = createFileService();

describe.each([null, 0o000, 0o400, 0o100])(
  "远程工作区目录 admission，权限 %s（null 为删除）",
  (permissions) => {
    it.each(["manual", "automatic"] as const)(
      "%s: Failure of a single directory only rejects that project; it can reconnect after being fixed",
      async (mode, context) => {
        if (permissions !== null && (process.platform === "win32" || process.getuid?.() === 0)) {
          context.skip();
        }
        const root = await realpath(await mkdtemp(join(tmpdir(), "cf-workspace-admission-")));
        const paths = [1, 2, 3].map((n) => join(root, `workspace-${n}`));
        const closedListeners = new Set<
          (event: { exitCode: number | null; signal: string | null; recoverable: boolean }) => void
        >();
        const reconnectedListeners = new Set<() => void>();
        const bindIdentity = vi.fn(async (_input: { workspacePath: string }) => undefined);
        const sessionClosed = vi.fn();
        const connect = vi.fn(async () => ({
          services: fileService,
          onDidClose: (
            listener: (event: {
              exitCode: number | null;
              signal: string | null;
              recoverable: boolean;
            }) => void,
          ) => {
            closedListeners.add(listener);
            return { dispose: () => closedListeners.delete(listener) };
          },
          onDidReconnect: (listener: () => void) => {
            reconnectedListeners.add(listener);
            return { dispose: () => reconnectedListeners.delete(listener) };
          },
          dispose: async () => undefined,
        }));
        let id = 0;
        const registry = createWindowRemoteConnectionRegistry({
          connect,
          createId: () => `session-${++id}`,
          resolveSourceServerId: () => "fixture-source",
          prepareWorkspaceIdentity: (handle, input) =>
            prepareRemoteWorkspaceIdentity(handle.services, input, bindIdentity),
          onSessionClosed: sessionClosed,
          logicalReplacementRetryDelaysMs: [],
        });
        const connectPath = async (workspacePath: string) =>
          registry.connect({
            requestId: `request-${id}`,
            target,
            remoteAssets: {},
            workspacePath,
            workspaceIdentity: `remote:server:fixture-source:${workspacePath}`,
          });
        try {
          for (const path of paths) {
            await mkdir(path);
            await connectPath(path);
          }
          expect(connect).toHaveBeenCalledTimes(1);
          if (permissions === null) await rm(paths[0]!, { recursive: true });
          else {
            await chmod(paths[0]!, permissions);
            await expect(fileService.stat({ path: paths[0]! })).resolves.toMatchObject({
              type: "directory",
            });
          }
          bindIdentity.mockClear();
          for (const listener of closedListeners)
            listener({ exitCode: 0, signal: null, recoverable: mode === "automatic" });
          if (mode === "manual") {
            await expect(connectPath(paths[0]!)).rejects.toMatchObject({
              code: unavailableCode,
              retryable: false,
            });
            await connectPath(paths[1]!);
            await connectPath(paths[2]!);
          } else {
            for (const listener of reconnectedListeners) listener();
            await vi.waitFor(() =>
              expect(sessionClosed.mock.calls.some(([event]) => event.recoverable === false)).toBe(
                true,
              ),
            );
            expect(sessionClosed).toHaveBeenCalledWith(
              expect.objectContaining({ reasonCode: unavailableCode, retryable: false }),
            );
          }
          expect(bindIdentity.mock.calls.map(([input]) => input.workspacePath)).toEqual(
            paths.slice(1),
          );
          expect(
            registry
              .listSessions()
              .filter((session) => session.state === "online")
              .map((session) => session.workspacePath)
              .sort(),
          ).toEqual(paths.slice(1));
          if (permissions === null) {
            await expect(stat(paths[0]!)).rejects.toMatchObject({ code: "ENOENT" });
            await mkdir(paths[0]!);
          } else await chmod(paths[0]!, 0o700);
          await expect(connectPath(paths[0]!)).resolves.toMatchObject({ workspacePath: paths[0] });
        } finally {
          await registry.dispose();
          if (permissions !== null) await chmod(paths[0]!, 0o700);
          await rm(root, { recursive: true, force: true });
        }
      },
    );
  },
);

describe("远程工作区目录 admission", () => {
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "Readable and traversable but non-writable empty directories can still be bound",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "cf-workspace-readonly-"));
      const bindIdentity = vi.fn();
      try {
        await chmod(root, 0o500);
        await prepareRemoteWorkspaceIdentity(
          fileService,
          {
            workspacePath: root,
            stableWorkspaceIdentity: `remote:server:fixture:${root}`,
          },
          bindIdentity,
        );
        expect(bindIdentity).toHaveBeenCalledTimes(1);
      } finally {
        await chmod(root, 0o700);
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("New directory binding rejects regular files and does not perform identity write", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-workspace-file-"));
    const path = join(root, "file");
    const bindIdentity = vi.fn();
    try {
      await writeFile(path, "fixture");
      await expect(
        prepareRemoteWorkspaceIdentity(
          fileService,
          { workspacePath: path, stableWorkspaceIdentity: "remote:server:fixture:/file" },
          bindIdentity,
        ),
      ).rejects.toMatchObject({ code: unavailableCode });
      expect(bindIdentity).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"])(
    "%s mapped as directory error; identity write is not performed without a valid directory",
    async (code) => {
      const bindIdentity = vi.fn();
      const remoteReaddir = vi.fn().mockRejectedValue(Object.assign(new Error(code), { code }));
      await expect(
        prepareRemoteWorkspaceIdentity(
          { readdir: remoteReaddir },
          {
            workspacePath: "/remote/project",
            stableWorkspaceIdentity: "remote:server:fixture:/remote/project",
          },
          bindIdentity,
        ),
      ).rejects.toMatchObject({ code: unavailableCode, retryable: false });
      expect(bindIdentity).not.toHaveBeenCalled();
    },
  );

  it("Network errors retain original errors; late readdir after cancellation will not write identity", async () => {
    const input = {
      workspacePath: "/remote/project",
      stableWorkspaceIdentity: "remote:server:fixture:/remote/project",
    };
    const error = Object.assign(new Error("transport closed"), { code: "ECONNRESET" });
    const bindIdentity = vi.fn();
    await expect(
      prepareRemoteWorkspaceIdentity(
        { readdir: vi.fn().mockRejectedValue(error) },
        input,
        bindIdentity,
      ),
    ).rejects.toBe(error);
    let finish!: (value: Awaited<ReturnType<IFileService["readdir"]>>) => void;
    const pending = new Promise<Awaited<ReturnType<IFileService["readdir"]>>>((resolve) => {
      finish = resolve;
    });
    const controller = new AbortController();
    const result = prepareRemoteWorkspaceIdentity(
      { readdir: () => pending },
      { ...input, signal: controller.signal },
      bindIdentity,
    );
    controller.abort();
    finish([]);
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(bindIdentity).not.toHaveBeenCalled();
  });

  it("Late directory verification after canceling logical connect must not proceed with preparing identity", async () => {
    let finish!: (value: Awaited<ReturnType<IFileService["readdir"]>>) => void;
    const pending = new Promise<Awaited<ReturnType<IFileService["readdir"]>>>((resolve) => {
      finish = resolve;
    });
    const remoteReaddir = vi.fn(() => pending);
    const bindIdentity = vi.fn();
    const registry = createWindowRemoteConnectionRegistry({
      connect: async () => ({
        services: { readdir: remoteReaddir },
        dispose: async () => undefined,
      }),
      createId: () => "canceled-session",
      resolveSourceServerId: () => "fixture-source",
      prepareWorkspaceIdentity: (handle, input) =>
        prepareRemoteWorkspaceIdentity(handle.services, input, bindIdentity),
    });
    try {
      const result = registry.connect({
        requestId: "cancel-request",
        target,
        remoteAssets: {},
        workspacePath: "/remote/project",
      });
      const rejected = expect(result).rejects.toThrow();
      await vi.waitFor(() => expect(remoteReaddir).toHaveBeenCalledTimes(1));
      registry.cancelConnect("cancel-request");
      await rejected;
      finish([]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(bindIdentity).not.toHaveBeenCalled();
      expect(registry.listSessions()).toEqual([]);
    } finally {
      await registry.dispose();
    }
  });
});
