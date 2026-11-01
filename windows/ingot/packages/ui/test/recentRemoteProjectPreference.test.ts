import { describe, expect, it } from "vitest";
import { resolveRecentRemoteProjectPreference } from "@/project-sidebar/remote-project-connection.js";
import type { RemoteProjectDirectory, RemoteProjectEntry } from "@/project-sidebar/contract.js";

const hostId = "remote:server:source-1";
const entry: RemoteProjectEntry = {
  id: "entry-1",
  hostId,
  projectId: "project-1",
  name: "project",
  roots: [{ rootPath: "/srv/project", position: 0, isPrimary: true }],
  legacyWorkspace: null,
  lastSyncedAt: null,
};
const directory: RemoteProjectDirectory = {
  hosts: [{ id: hostId, membershipId: "member-1", kind: "ssh", target: null, position: 0 }],
  entries: [entry],
};
const input = { sourceServerId: "source-1", path: "/srv/project", profileId: "profile-1" };

describe("设置最近远程项目的打开意图", () => {
  it("Pin existing project entries by Source and path without relying on renderer tab", () => {
    expect(resolveRecentRemoteProjectPreference(directory, input)).toEqual({
      preferredProfileId: "profile-1",
      preferredDirectoryPath: "/srv/project",
      preferredProjectEntryId: "entry-1",
    });
  });
  it("Projects with identical paths on other devices will not match", () => {
    const other = { ...entry, id: "other", hostId: "remote:server:source-2" };
    expect(
      resolveRecentRemoteProjectPreference({ ...directory, entries: [other, entry] }, input),
    ).toHaveProperty("preferredProjectEntryId", "entry-1");
    expect(
      resolveRecentRemoteProjectPreference({ ...directory, entries: [other] }, input),
    ).toBeNull();
  });
  it("Preserves Source and still pins project entry when no route is specified", () => {
    expect(
      resolveRecentRemoteProjectPreference(directory, { ...input, profileId: undefined }),
    ).toEqual({
      preferredSourceServerId: "source-1",
      preferredDirectoryPath: "/srv/project",
      preferredProjectEntryId: "entry-1",
    });
  });
  it("Does not generate create intent or guess the first item when entry is removed, Host is removed, or multiple projects exist in the same directory", () => {
    expect(resolveRecentRemoteProjectPreference({ ...directory, entries: [] }, input)).toBeNull();
    expect(resolveRecentRemoteProjectPreference({ ...directory, hosts: [] }, input)).toBeNull();
    expect(
      resolveRecentRemoteProjectPreference(
        { ...directory, entries: [entry, { ...entry, id: "entry-2", projectId: "project-2" }] },
        input,
      ),
    ).toBeNull();
  });
  it("Legacy project entries still resolve using the preserved remote directory", () => {
    const legacy: RemoteProjectEntry = {
      ...entry,
      projectId: null,
      roots: [],
      legacyWorkspace: {
        kind: "remote",
        workspacePath: input.path,
        lastOpenedAt: 1,
        lastConnectionStatus: "connected",
        target: { kind: "ssh", host: "dev.example.com", username: "dev" },
      },
    };
    expect(
      resolveRecentRemoteProjectPreference({ ...directory, entries: [legacy] }, input),
    ).toHaveProperty("preferredProjectEntryId", "entry-1");
  });
});
