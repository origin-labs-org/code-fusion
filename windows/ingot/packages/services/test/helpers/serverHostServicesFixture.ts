import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IProjectService, ISourceServerWorkspaceService } from "@origin-ai/cf-services";
import { buildServerRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { createServerHostServices, disposeServiceResourcesAndWait } from "../../src/node.js";

const home = process.env.HOME!;
const host = await createServerHostServices({
  sourceServerId: "server-owner",
  cfBuiltinProviderConfigFilePath: resolve("config/provider/cf-builtin.json"),
});
try {
  const db = new DatabaseSync(join(home, ".cf/v2/tasks-index.sqlite"), { readOnly: true });
  try {
    assert.ok(db.prepare("SELECT id FROM schema_migration WHERE id='0005_projects'").get());
  } finally {
    db.close();
  }
  const root = join(home, "repo");
  await mkdir(root);
  const project = await host.services
    .get(IProjectService)
    .saveProject({ name: "Server", roots: [root], primaryRoot: root });
  assert.equal(project.hostId, "remote:server:server-owner");
  const mapping = await host.services
    .get(ISourceServerWorkspaceService)
    .resolveWorkspace({ workspacePath: root });
  assert.deepEqual(
    host.workspaceIdentityMapper.mapIncoming({
      workspaceIdentity: buildServerRemoteWorkspaceIdentity({
        serverId: "server-owner",
        workspacePath: root,
      }),
    }),
    { workspaceIdentity: mapping.canonicalWorkspaceKey },
  );
  assert.equal((await host.services.get(IProjectService).readTree()).projects.length, 1);
} finally {
  await disposeServiceResourcesAndWait(host.services);
}
process.stdout.write("SERVER_HOST_VERIFIED\n");
process.exit(0);
