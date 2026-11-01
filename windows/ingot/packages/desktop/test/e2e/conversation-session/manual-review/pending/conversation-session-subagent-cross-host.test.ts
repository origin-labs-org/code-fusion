import { subagentUpdateCursor } from "../../../helpers/subagent-snapshot-wait.js";
import { exerciseSubagentHostBranches } from "../../../helpers/subagent-host-branches.js";
import {
  openSubagentHostWindow,
  setHostFaults,
  waitForHostBoundary,
} from "../../../helpers/subagent-host-window.js";
import { writeFile, mkdir, stat, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  clearAppData,
  waitForWorkspaceApp,
  getE2EAppDataPaths,
} from "../../../helpers/desktop-app.js";
import {
  prepareV4ConversationE2E,
  startNewV4Draft,
  getV4PaneSnapshot,
  sendV4PromptAndWaitAccepted,
  sendV4Prompt,
} from "../../../helpers/v4-conversation.js";
import {
  useEnglishSubagentSettings,
  finishSubagentTurn,
} from "../../../helpers/subagent-refresh-conversation.js";
import {
  saveRefreshProfile,
  type RefreshProfile,
} from "../../../helpers/subagent-refresh-settings.js";
import {
  waitForSubagentRequest,
  readSubagentCapture,
  assertSubagentProfile,
  readChildSessionIds,
  boundaryRpcReads,
  assertChildTrajectory,
} from "../../../helpers/subagent-refresh-capture.js";
import {
  UPSTREAM_MODEL,
  UPSTREAM_PROVIDER_ID,
  UPSTREAM_ALTERNATE_MODEL,
  UPSTREAM_ALTERNATE_PROVIDER_ID,
  selectUpstreamModel,
  selectUpstreamThoughtLevel,
} from "../../../helpers/upstream-provider.js";
import {
  assertProviderPrefix,
  assertRequestCacheBreakpoint,
  type CapturedPrompt,
} from "../../../helpers/provider-prefix.js";
import { exportPromptTrajectory } from "../../../helpers/prompt-trajectory-export.js";

const old: RefreshProfile = {
  name: "e2e-host-reviewer",
  description: "Host refresh",
  prompt: "E2E_SHI_PROFILE_OLD",
  model: UPSTREAM_MODEL,
  provider: UPSTREAM_PROVIDER_ID,
  effort: "low",
  tools: ["Read"],
};
const updated: RefreshProfile = {
  ...old,
  prompt: "E2E_SHI_PROFILE_NEW",
  model: UPSTREAM_ALTERNATE_MODEL,
  provider: UPSTREAM_ALTERNATE_PROVIDER_ID,
  effort: "high",
  tools: ["Grep"],
};

describe("Subagent 跨真实 Host 失效", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });
  it("SHR22: Dual hosts consume updates from case-differing directories, initial creation, and recreation of project directories", async function () {
    this.timeout(300000);
    await prepareV4ConversationE2E();
    await useEnglishSubagentSettings();
    const storage = getE2EAppDataPaths().storageRoot;
    const probe = join(storage, "CaseProbe");
    await mkdir(probe);
    try {
      const actual = await stat(probe);
      const alias = await stat(join(storage, "caseprobe")).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!alias || actual.dev !== alias.dev || actual.ino !== alias.ino) this.skip();
    } finally {
      await rm(probe, { recursive: true });
    }
    const profile = { ...old, name: "e2e-path-reviewer", prompt: "E2E_SHP_PROFILE_OLD" };
    const next = { ...profile, prompt: "E2E_SHP_PROFILE_NEW" };
    await saveRefreshProfile(profile);
    const initialHandle = await browser.getWindowHandle();
    const projectRoot = join(getE2EAppDataPaths().workspace, ".cf", "agents");
    await rm(projectRoot, { recursive: true, force: true });
    const root = join(storage, "agents");
    await rename(root, root + "-case-tmp");
    await rename(root + "-case-tmp", join(storage, "AGENTS"));
    const nestedName = "e2e-nested-ignored";
    const nestedRoot = join(root, "nested");
    await mkdir(nestedRoot);
    await writeFile(
      join(nestedRoot, `${nestedName}.md`),
      `---\nname: ${nestedName}\ndescription: Nested profile\n---\nNested profile must not be listed.`,
    );
    const windows: Array<Awaited<ReturnType<typeof openSubagentHostWindow>>> = [];
    const sessions: Array<{
      side: string;
      sessionId: string;
      hostPid: number;
      cliPid: number;
      handle: string;
    }> = [];
    try {
      for (const side of ["A", "B"]) {
        const window = await openSubagentHostWindow();
        windows.push(window);
        await waitForWorkspaceApp(getE2EAppDataPaths().workspace, 30000);
        await startNewV4Draft();
        await selectUpstreamModel();
        await selectUpstreamThoughtLevel();
        const marker = `E2E_SHP_${side}_SEED`;
        await sendV4PromptAndWaitAccepted(`${marker}: Remember this session.`, marker, marker);
        await finishSubagentTurn(`${marker}_DONE`, 60000);
        const sessionId = (await getV4PaneSnapshot()).sessionId!;
        const rpc = (await boundaryRpcReads()).find(
          (r) => r.sessionId === sessionId && r.kind === "read",
        )!;
        expect(rpc).toBeTruthy();
        sessions.push({
          side,
          sessionId,
          hostPid: rpc.hostPid,
          cliPid: rpc.pid,
          handle: window.handle,
        });
        const seed = await waitForSubagentRequest(`shp-${side.toLowerCase()}-seed`);
        expect(JSON.stringify(seed.requestJson)).toContain(profile.name);
        expect(JSON.stringify(seed.requestJson)).not.toContain(nestedName);
      }
      expect(sessions[0]!.hostPid).not.toBe(sessions[1]!.hostPid);
      expect(sessions[0]!.cliPid).not.toBe(sessions[1]!.cliPid);
      await browser.switchToWindow(sessions[0]!.handle);
      await useEnglishSubagentSettings();
      const published = await subagentUpdateCursor();
      let publicationError: string | undefined;
      try {
        await saveRefreshProfile(next, profile.name);
        await published(
          sessions.map((s) => s.hostPid),
          [`${profile.name}.md`],
        );
      } catch (error) {
        if (!String(error).includes("Host failed to complete config file update")) throw error;
        publicationError = String(error);
      }
      const disk = await readFile(join(storage, "AGENTS", `${profile.name}.md`), "utf8");
      expect(disk).toContain(next.prompt);
      const children: Array<{
        capture: Awaited<ReturnType<typeof waitForSubagentRequest>>;
        profile: RefreshProfile;
      }> = [];
      const stages = ["NEXT", "CREATED", "REBUILT"] as const;
      for (const [stageIndex, stage] of stages.entries()) {
        const expected = stage === "NEXT" ? next : { ...next, prompt: `E2E_SHP_PROFILE_${stage}` };
        if (stage !== "NEXT") {
          await browser.switchToWindow(sessions[0]!.handle);
          if (stage === "REBUILT") {
            const removed = await subagentUpdateCursor();
            await rm(projectRoot, { recursive: true });
            await removed(
              sessions.map((s) => s.hostPid),
              [projectRoot],
            );
          }
          const created = await subagentUpdateCursor();
          await saveRefreshProfile(expected, undefined, {
            workspacePath: getE2EAppDataPaths().workspace,
          });
          await created(
            sessions.map((s) => s.hostPid),
            [projectRoot],
          );
          expect(await readFile(join(projectRoot, `${profile.name}.md`), "utf8")).toContain(
            expected.prompt,
          );
        }
        for (const session of sessions) {
          await browser.switchToWindow(session.handle);
          const marker = `E2E_SHP_${session.side}_${stage}`;
          await sendV4PromptAndWaitAccepted(`${marker}: Launch ${profile.name}.`, marker, marker);
          await finishSubagentTurn(`${marker}_DONE`, 60000);
          expect((await getV4PaneSnapshot()).sessionId).toBe(session.sessionId);
          const id = `shp-${session.side.toLowerCase()}-${stage.toLowerCase()}-child`;
          children.push({ capture: await waitForSubagentRequest(id), profile: expected });
          const childIds = readChildSessionIds(session.sessionId);
          expect(childIds).toHaveLength(stageIndex + 1);
          await assertChildTrajectory(childIds.at(-1)!, [id]);
          const bodies = (await readSubagentCapture())
            .filter((r) =>
              new RegExp(
                `^shp-${session.side.toLowerCase()}-(seed|(?:next|created|rebuilt)-(?:tool|final))$`,
                "u",
              ).test(r.replay?.fixtureId ?? ""),
            )
            .map((r) => r.requestJson as CapturedPrompt);
          const requestCount = 3 + stageIndex * 2;
          expect(bodies).toHaveLength(requestCount);
          for (const body of bodies) expect(JSON.stringify(body)).not.toContain(nestedName);
          for (let i = 1; i < bodies.length; i++) assertProviderPrefix(bodies[i - 1]!, bodies[i]!);
          const trajectory = await exportPromptTrajectory(
            session.sessionId,
            `subagent-path-${session.side}-${stage}`,
          );
          expect(trajectory.trajectories).toEqual([
            expect.objectContaining({ reason: "initial", requestCount }),
          ]);
        }
      }
      await writeFile(
        join(process.env.CF_E2E_ARTIFACT_DIR!, "subagent-path-evidence.json"),
        JSON.stringify(
          {
            sessions,
            disk,
            publicationError,
            requests: children.map(({ capture, profile }) => ({
              id: capture.replay?.fixtureId,
              request: capture.requestJson,
              expected: profile,
            })),
          },
          null,
          2,
        ),
      );
      const failures: string[] = [];
      for (const { capture: child, profile: expected } of children) {
        try {
          assertRequestCacheBreakpoint(child.requestJson as CapturedPrompt);
          assertSubagentProfile(child, expected);
        } catch (error) {
          failures.push(`${child.replay?.fixtureId}: ${String(error)}`);
        }
      }
      expect(failures).toEqual([]);
      expect(publicationError).toBeUndefined();
    } finally {
      for (const window of windows)
        await browser.electron.execute(
          (electron, id) => electron.BrowserWindow.fromId(id)?.destroy(),
          window.windowId,
        );
      await rm(projectRoot, { recursive: true, force: true });
      await browser.switchToWindow(initialHandle);
      await rm(nestedRoot, { recursive: true, force: true });
      await rename(join(storage, "AGENTS"), root + "-case-tmp");
      await rename(root + "-case-tmp", root);
    }
  });
  it("SHR16/SHR18-SHR21: Dual-host directory, overwrite, invalidation failure, concurrency, and destruction boundaries", async function () {
    this.timeout(600000);
    await prepareV4ConversationE2E();
    await useEnglishSubagentSettings();
    await saveRefreshProfile(old);
    await turn("A_SEED");
    const a = (await getV4PaneSnapshot()).sessionId!;
    const aHandle = await browser.getWindowHandle();
    const { windowId: bWindowId, handle: bHandle } = await openSubagentHostWindow();
    try {
      await waitForWorkspaceApp(getE2EAppDataPaths().workspace, 30000);
      await startNewV4Draft();
      await selectUpstreamModel();
      await selectUpstreamThoughtLevel();
      await turn("B_SEED");
      const b = (await getV4PaneSnapshot()).sessionId!;
      expect(b).not.toBe(a);
      const childId = readChildSessionIds(b)[0]!;
      expect(childId).toBeTruthy();
      assertSubagentProfile(await waitForSubagentRequest("shi-b-seed-child"), old);
      const rpc = await boundaryRpcReads();
      const aRead = rpc.find((r) => r.sessionId === a && r.kind === "read")!;
      const bRead = rpc.find((r) => r.sessionId === b && r.kind === "read")!;
      expect(aRead.hostPid).not.toBe(bRead.hostPid);
      expect(aRead.pid).not.toBe(bRead.pid);
      await send("B_HOLD");
      await browser.waitUntil(
        async () =>
          (await readSubagentCapture()).some((r) => r.replay?.fixtureId === "shi-b-hold-tool"),
        { timeout: 30000 },
      );
      const published = await subagentUpdateCursor();
      await browser.switchToWindow(aHandle);
      await saveRefreshProfile(updated, old.name);
      await published([aRead.hostPid, bRead.hostPid]);
      await browser.switchToWindow(bHandle);
      assertSubagentProfile(await waitForSubagentRequest("shi-b-hold-child"), old);
      await finish("B_HOLD");
      await browser.switchToWindow(aHandle);
      await turn("A_NEXT");
      assertSubagentProfile(await waitForSubagentRequest("shi-a-next-child"), updated);
      expect((await getV4PaneSnapshot()).sessionId).toBe(a);
      await browser.switchToWindow(bHandle);
      await turn("B_RESUME");
      assertSubagentProfile(await waitForSubagentRequest("shi-b-resume-child"), updated);
      expect(readChildSessionIds(b)).toEqual([childId]);
      await turn("B_SPAWN");
      assertSubagentProfile(await waitForSubagentRequest("shi-b-spawn-child"), updated);
      expect(readChildSessionIds(b)).toHaveLength(2);
      const bodies = (await readSubagentCapture())
        .filter((r) =>
          /^shi-b-(seed|hold|resume|spawn)-(tool|final|notification)$/u.test(
            r.replay?.fixtureId ?? "",
          ),
        )
        .map((r) => r.requestJson as CapturedPrompt);
      expect(bodies).toHaveLength(10);
      for (let i = 1; i < bodies.length; i++) assertProviderPrefix(bodies[i - 1]!, bodies[i]!);
      const trajectory = await exportPromptTrajectory(b, "subagent-cross-host-parent");
      expect(trajectory.trajectories).toEqual([
        expect.objectContaining({ reason: "initial", requestCount: 10 }),
      ]);
      for (const id of [
        "shi-b-seed-child",
        "shi-b-hold-child",
        "shi-b-resume-child",
        "shi-b-spawn-child",
      ])
        assertRequestCacheBreakpoint(
          (await waitForSubagentRequest(id)).requestJson as CapturedPrompt,
        );
      await assertChildTrajectory(childId, [
        "shi-b-seed-child",
        "shi-b-hold-child",
        "shi-b-resume-child",
      ]);
      const allReads = (await boundaryRpcReads()).filter(
        (r) => r.sessionId === b && r.kind === "read",
      );
      expect(allReads).toHaveLength(1 + 6);
      expect(new Set(allReads.map((r) => r.pid))).toEqual(new Set([bRead.pid]));
      const aReads = (await boundaryRpcReads()).filter(
        (r) => r.sessionId === a && r.kind === "read",
      );
      expect(aReads).toHaveLength(1 + 2);
      expect(new Set(aReads.map((r) => r.pid))).toEqual(new Set([aRead.pid]));
      const aBodies = (await readSubagentCapture())
        .filter((r) => /^shi-a-(seed|next-tool|next-final)$/u.test(r.replay?.fixtureId ?? ""))
        .map((r) => r.requestJson as CapturedPrompt);
      expect(aBodies).toHaveLength(3);
      for (let i = 1; i < aBodies.length; i++) assertProviderPrefix(aBodies[i - 1]!, aBodies[i]!);
      const aTrajectory = await exportPromptTrajectory(a, "subagent-cross-host-a-parent");
      expect(aTrajectory.trajectories).toEqual([
        expect.objectContaining({ reason: "initial", requestCount: 3 }),
      ]);
      const latest = await exerciseSubagentHostBranches(
        {
          a: { handle: aHandle, sessionId: a, hostPid: aRead.hostPid, cliPid: aRead.pid },
          b: { handle: bHandle, sessionId: b, hostPid: bRead.hostPid, cliPid: bRead.pid },
        },
        old,
        updated,
      );
      const disposalProfile = { ...latest, prompt: "E2E_SHB_COLD_PROFILE" };
      const file = join(getE2EAppDataPaths().storageRoot, "agents", `${old.name}.md`);
      await setHostFaults({
        files: [{ id: "dispose", operation: "readFile", path: file, action: "hold", once: true }],
      });
      await browser.switchToWindow(aHandle);
      await saveRefreshProfile(disposalProfile, old.name);
      await waitForHostBoundary("file-held", "dispose");
      await writeFile(
        join(process.env.CF_E2E_ARTIFACT_DIR!, "subagent-config-control.json"),
        JSON.stringify({ heldSessionIds: [b] }),
      );
      const beforeClosing = (await boundaryRpcReads()).filter(
        (r) => r.sessionId === b && r.kind === "read",
      ).length;
      await browser.switchToWindow(bHandle);
      await sendV4Prompt("E2E_SHB_CLOSE_WAIT: Await configuration before executing.");
      await browser.waitUntil(
        async () =>
          (await boundaryRpcReads()).filter((r) => r.sessionId === b && r.kind === "read")
            .length ===
          beforeClosing + 1,
        { timeout: 15000 },
      );
      await browser.waitUntil(
        async () => (await boundaryRpcReads()).some((r) => r.sessionId === b && r.kind === "held"),
        { timeout: 15000 },
      );
      await browser.electron.execute(
        (electron, id) => electron.BrowserWindow.fromId(id)?.destroy(),
        bWindowId,
      );
      await browser.waitUntil(
        () => {
          try {
            process.kill(bRead.hostPid, 0);
            return false;
          } catch (error) {
            return (error as NodeJS.ErrnoException).code === "ESRCH";
          }
        },
        { timeout: 15000, timeoutMsg: "Host awaiting config read has not exited" },
      );
      await setHostFaults({ released: ["dispose"] });
      const requestsAfterClose = (await readSubagentCapture()).filter((r) =>
        JSON.stringify(r.requestJson).includes("E2E_SHB_CLOSE_WAIT:"),
      );
      const cold = await openSubagentHostWindow();
      try {
        await waitForWorkspaceApp(getE2EAppDataPaths().workspace, 30000);
        await startNewV4Draft();
        await selectUpstreamModel();
        await selectUpstreamThoughtLevel();
        await sendV4PromptAndWaitAccepted(
          "E2E_SHB_COLD_START: Launch the current reviewer.",
          "E2E_SHB_COLD_START",
          "Cold start not received",
        );
        await finishSubagentTurn("E2E_SHB_COLD_START_DONE", 60000);
        const coldSession = (await getV4PaneSnapshot()).sessionId!;
        assertSubagentProfile(
          await waitForSubagentRequest("shb-cold_start-child"),
          disposalProfile,
        );
        const coldReads = (await boundaryRpcReads()).filter(
          (r) => r.sessionId === coldSession && r.kind === "read",
        );
        expect(coldReads).toHaveLength(1 + 1);
        expect([aRead.hostPid, bRead.hostPid]).not.toContain(coldReads[0]!.hostPid);
        expect([aRead.pid, bRead.pid]).not.toContain(coldReads[0]!.pid);
        const exported = await exportPromptTrajectory(coldSession, "subagent-host-cold-start");
        expect(exported.trajectories).toEqual([
          expect.objectContaining({ reason: "initial", requestCount: 2 }),
        ]);
        await assertChildTrajectory(readChildSessionIds(coldSession)[0]!, ["shb-cold_start-child"]);
      } finally {
        await browser.electron.execute(
          (electron, id) => electron.BrowserWindow.fromId(id)?.destroy(),
          cold.windowId,
        );
      }
      expect(requestsAfterClose).toHaveLength(0);
    } finally {
      await browser.electron.execute(
        (electron, id) => electron.BrowserWindow.fromId(id)?.destroy(),
        bWindowId,
      );
      await browser.switchToWindow(aHandle);
    }
  });
});
async function send(stage: string) {
  const marker = `E2E_SHI_${stage}`;
  await sendV4PromptAndWaitAccepted(
    `${marker}: ${stage === "A_SEED" ? "Remember this session." : stage === "B_HOLD" || stage === "B_RESUME" ? "Resume the existing subagent using SendMessage." : `Launch ${old.name}.`}`,
    marker,
    `未接收 ${marker}`,
  );
}
const finish = (stage: string) =>
  finishSubagentTurn(
    `E2E_SHI_${stage}_${stage === "B_HOLD" || stage === "B_RESUME" ? "SETTLED" : "DONE"}`,
    90000,
  );
async function turn(stage: string) {
  await send(stage);
  await finish(stage);
}
