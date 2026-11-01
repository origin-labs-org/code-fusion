import {
  sourceServerManagementSnapshotSchema,
  type SourceServerManagementSnapshot,
} from "@origin-ai/cf-shared";
import type { ManagedSourceServerConnection } from "./sourceServerConnectionManager.js";
import type { SourceServerDirectorySnapshot } from "./sourceServerDirectory.js";

export function createSourceServerMigrationCounts(options: {
  getOnlineConnection(sourceServerId: string): ManagedSourceServerConnection | undefined;
  onDidChange(): void;
}) {
  let disposed = false;
  type MigrationCount = SourceServerManagementSnapshot["migrationCounts"][number];
  interface MigrationRead {
    connection: ManagedSourceServerConnection;
    value: MigrationCount;
    refreshRequested: boolean;
  }
  const migrationReads = new Map<string, MigrationRead>();
  function invalidateMigrationCounts(sourceServerId?: string) {
    for (const [id, entry] of migrationReads) {
      if (sourceServerId !== undefined && id !== sourceServerId) continue;
      if (entry.value.status === "loading") entry.refreshRequested = true;
      else migrationReads.delete(id);
    }
  }
  function startMigrationRead(sourceServerId: string, entry: MigrationRead) {
    void (async () => {
      let value: MigrationCount;
      try {
        const service = entry.connection.services.sourceServerWorkspaceService;
        const [failed, abandoned] = await Promise.allSettled([
          Promise.resolve().then(() => service.getFailedPathCount()),
          Promise.resolve().then(() => service.getAbandonedPathCount()),
        ]);
        if (failed.status !== "fulfilled" || abandoned.status !== "fulfilled") {
          throw new Error("Migration counts unavailable");
        }
        value = sourceServerManagementSnapshotSchema.shape.migrationCounts.element.parse({
          sourceServerId,
          status: "available",
          failedPathCount: failed.value,
          abandonedPathCount: abandoned.value,
        });
      } catch {
        value = { sourceServerId, status: "unavailable" };
      }
      if (
        disposed ||
        migrationReads.get(sourceServerId) !== entry ||
        options.getOnlineConnection(sourceServerId) !== entry.connection
      )
        return;
      if (entry.refreshRequested) {
        entry.refreshRequested = false;
        startMigrationRead(sourceServerId, entry);
        return;
      }
      entry.value = value;
      options.onDidChange();
    })();
  }

  function readMigrationCounts(directory: SourceServerDirectorySnapshot): {
    failedPathCount: number;
    abandonedPathCount: number;
    migrationCounts: SourceServerManagementSnapshot["migrationCounts"];
  } {
    const activeSources = new Set(directory.servers.map((server) => server.sourceServerId));
    for (const id of migrationReads.keys()) {
      if (!activeSources.has(id)) migrationReads.delete(id);
    }
    const migrationCounts = directory.servers.map((server): MigrationCount => {
      const connection = options.getOnlineConnection(server.sourceServerId);
      if (!connection) {
        migrationReads.delete(server.sourceServerId);
        return {
          sourceServerId: server.sourceServerId,
          status: "requires-connection" as const,
        };
      }
      let entry = migrationReads.get(server.sourceServerId);
      if (!entry || entry.connection !== connection) {
        entry = {
          connection,
          value: { sourceServerId: server.sourceServerId, status: "loading" },
          refreshRequested: false,
        };
        migrationReads.set(server.sourceServerId, entry);
        startMigrationRead(server.sourceServerId, entry);
      }
      return entry.value;
    });
    const totals = migrationCounts.reduce(
      (total, count) => ({
        failedPathCount:
          total.failedPathCount + (count.status === "available" ? count.failedPathCount : 0),
        abandonedPathCount:
          total.abandonedPathCount + (count.status === "available" ? count.abandonedPathCount : 0),
      }),
      { failedPathCount: 0, abandonedPathCount: 0 },
    );
    return { ...totals, migrationCounts };
  }

  return {
    read: readMigrationCounts,
    invalidate: invalidateMigrationCounts,
    dispose() {
      disposed = true;
      migrationReads.clear();
    },
  };
}
