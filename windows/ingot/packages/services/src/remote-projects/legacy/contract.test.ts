import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { projectStorage } from "#src/project-storage/index.js";
import { createRemoteProjectService } from "#src/remote-projects/index.js";

it("Legacy single-root upgrade resolves real ID via original entry\'s version CAS; late results do not revive deleted entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "legacy-entry-"));
  const db = new DatabaseSync(":memory:");
  try {
    await projectStorage.migrate(db, { backupDirectories: [dir] });
    const service = createRemoteProjectService({ database: async () => db });
    await service.saveHost({ id: "remote:server:s", target: { kind: "docker", container: "s" } });
    const project = {
      projectId: "legacy-single-root:a",
      name: "a",
      roots: [{ rootPath: "/a", position: 0, isPrimary: true }],
    };
    const entry = await service.addEntry({ hostId: "remote:server:s", project });
    expect(
      await service.refreshEntry({
        entryId: entry.id,
        expectedLastSyncedAt: entry.lastSyncedAt,
        project: { ...project, projectId: "real" },
      }),
    ).toBe(true);
    const resolved = (await service.readDirectory()).entries[0]!;
    expect(resolved).toMatchObject({ id: entry.id, projectId: "real" });
    expect(
      await service.refreshEntry({
        entryId: entry.id,
        expectedLastSyncedAt: entry.lastSyncedAt,
        project,
      }),
    ).toBe(false);
    await service.removeEntry(entry.id);
    expect(
      await service.refreshEntry({
        entryId: entry.id,
        expectedLastSyncedAt: resolved.lastSyncedAt,
        project: { ...project, projectId: "real" },
      }),
    ).toBe(false);
    expect((await service.readDirectory()).entries).toEqual([]);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("Creation wizard\'s legacy membership cannot register entry after deleting and recreating Host", async () => {
  const dir = await mkdtemp(join(tmpdir(), "late-entry-"));
  const db = new DatabaseSync(":memory:");
  try {
    await projectStorage.migrate(db, { backupDirectories: [dir] });
    const service = createRemoteProjectService({ database: async () => db });
    const target = { kind: "docker" as const, container: "s" };
    const old = await service.saveHost({ id: "remote:server:s", target });
    await service.removeHost(old.id);
    await service.saveHost({ id: old.id, target });
    await expect(
      service.addEntry({
        hostId: old.id,
        expectedMembershipId: old.membershipId,
        project: {
          projectId: "p",
          name: "P",
          roots: [{ rootPath: "/repo", position: 0, isPrimary: true }],
        },
      }),
    ).rejects.toThrow("remote-project.host-removed");
    expect((await service.readDirectory()).entries).toHaveLength(0);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
