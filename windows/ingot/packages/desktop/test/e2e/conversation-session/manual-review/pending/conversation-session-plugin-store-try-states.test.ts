import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TID_V4_COMPOSER_INPUT } from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  setInputValueByTestIdDom,
} from "../../../helpers/desktop-app.js";
import {
  ELECTRON_WINDOW_RECORDING_CAPTURE_MODE,
  startElectronWindowRecording,
} from "../../../helpers/electron-window-recorder.js";
import {
  getV4ComposerText,
  waitForV4MentionOptionPrefix,
  waitForV4Pane,
} from "../../../helpers/v4-conversation.js";
import {
  PLUGIN_LIFECYCLE_EXAMPLE_PROMPT,
  PLUGIN_LIFECYCLE_ID,
  PLUGIN_LIFECYCLE_MARKETPLACE_ID,
  capturePluginManualReview,
  clickPluginControl,
  createPluginLifecycleFixture,
  openPluginCard,
  openPluginSettings,
  pluginStoragePath,
  requirePluginManualReview,
  waitForPluginControl,
} from "../../../helpers/plugin-management-lifecycle.js";

const CASE_TIMEOUT_MS = 300_000;
const CASE_ID = "PLG12-TRY-STATES";
const ARTIFACT_DIR = join(
  process.cwd(),
  ".e2e-artifacts",
  "plugin-management",
  CASE_ID.toLowerCase(),
);
const VIDEO_PATH = join(ARTIFACT_DIR, "plugin-store-try-states.webm");
const VIDEO_MANIFEST_PATH = join(
  ARTIFACT_DIR,
  "plugin-store-try-states.recording.json",
);

describe("PLG12 Plugin Store trial state visual acceptance", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Covers uninstalled, enabled, disabled, and reserved @ Plugin candidate panels", async function () {
    this.timeout(CASE_TIMEOUT_MS);
    requirePluginManualReview();

    const fixture = await createPluginLifecycleFixture("1.0.0");
    await seedLifecycleMarketplaceCache(fixture.marketplaceRoot);
    await openPluginSettings();
    await clickPluginControl("plugin-store-segment-personal");
    await openPluginCard(PLUGIN_LIFECYCLE_ID);
    await waitForPluginControl("plugin-store-example-prompt", {
      pluginId: PLUGIN_LIFECYCLE_ID,
    });

    const recording = await startElectronWindowRecording({
      frameIntervalMs: 250,
      outputPath: VIDEO_PATH,
      preRollDurationMs: 500,
    });

    try {
      await capturePluginManualReview(CASE_ID, "01-uninstalled-detail");

      await clickPluginControl("plugin-store-example-prompt", {
        pluginId: PLUGIN_LIFECYCLE_ID,
      });
      await waitForPluginControl(
        "plugin-store-enabled-switch",
        { pluginId: PLUGIN_LIFECYCLE_ID },
        120_000,
      );
      expect(await isPluginSettingsVisible()).toBe(true);
      await waitForEnabledSwitchState(true);
      await capturePluginManualReview(CASE_ID, "02-installed-stays-detail");

      await clickPluginControl("plugin-store-example-prompt", {
        pluginId: PLUGIN_LIFECYCLE_ID,
      });
      await expectTryDraft("enabled");
      await capturePluginManualReview(CASE_ID, "03-enabled-try-draft");
      expect(
        await countCapturedRequestsContaining(
          PLUGIN_LIFECYCLE_EXAMPLE_PROMPT,
        ),
      ).toBe(0);

      await openPluginSettings();
      await clickPluginControl("plugin-store-segment-personal");
      await openPluginCard(PLUGIN_LIFECYCLE_ID);
      await clickPluginControl("plugin-store-enabled-switch", {
        pluginId: PLUGIN_LIFECYCLE_ID,
      });
      await waitForEnabledSwitchState(false);
      await capturePluginManualReview(CASE_ID, "04-disabled-detail");
      await clickPluginControl("plugin-store-example-prompt", {
        pluginId: PLUGIN_LIFECYCLE_ID,
      });
      await expectTryDraft("disabled");
      await capturePluginManualReview(CASE_ID, "05-disabled-try-draft");
      expect(
        await countCapturedRequestsContaining(
          PLUGIN_LIFECYCLE_EXAMPLE_PROMPT,
        ),
      ).toBe(0);

      await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "@", {
        timeout: 15_000,
        timeoutMsg: "PLG12 visual review could not edit the v4 composer",
      });
      const optionId = await waitForV4MentionOptionPrefix("plugin:", 30_000);
      expect(optionId.startsWith("plugin:")).toBe(true);
      await capturePluginManualReview(CASE_ID, "06-at-plugin-picker-retained");
    } finally {
      const recordingResult = await recording.stop({
        tailDurationMs: 1_000,
        timeoutMs: 60_000,
      });
      expect(recordingResult.captureMode).toBe(
        ELECTRON_WINDOW_RECORDING_CAPTURE_MODE,
      );
      expect(recordingResult.frameCount).toBeGreaterThan(1);
      expect(recordingResult.captureError).toBeUndefined();
      await writeFile(
        VIDEO_MANIFEST_PATH,
        `${JSON.stringify(
          {
            caseId: CASE_ID,
            frameCount: recordingResult.frameCount,
            states: [
              "uninstalled-install-only",
              "installed-enabled-canonical-draft",
              "installed-disabled-canonical-draft",
              "composer-at-plugin-picker-retained",
            ],
            video_capture_mode: recordingResult.captureMode,
            videoPath: recordingResult.videoPath,
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );
    }
  });
});

async function expectTryDraft(pluginState: "enabled" | "disabled"): Promise<void> {
  await waitForV4Pane(
    (state) => state.sessionId === "draft" && !state.canStop,
    `Plugin Store try did not enter an idle draft for ${pluginState} Plugin`,
    30_000,
  );
  await browser.waitUntil(
    async () => {
      const composerText = (await getV4ComposerText()) ?? "";
      return (
        composerText.includes(`plugin://${PLUGIN_LIFECYCLE_ID}`) &&
        composerText.endsWith(` ${PLUGIN_LIFECYCLE_EXAMPLE_PROMPT}`)
      );
    },
    {
      timeout: 30_000,
      timeoutMsg:
        `Plugin Store try did not prefill canonical Plugin reference and prompt for ${pluginState} Plugin`,
    },
  );
}

async function isPluginSettingsVisible(): Promise<boolean> {
  return browser.execute(() =>
    Boolean(document.querySelector('[data-testid="plugin-store-root"]')),
  );
}

async function seedLifecycleMarketplaceCache(
  marketplaceRoot: string,
): Promise<void> {
  const managedMarketplaceRoot = pluginStoragePath(
    "marketplaces",
    PLUGIN_LIFECYCLE_MARKETPLACE_ID,
  );
  await mkdir(dirname(managedMarketplaceRoot), { recursive: true });
  await cp(marketplaceRoot, managedMarketplaceRoot, {
    force: true,
    recursive: true,
  });
  await writeFile(
    join(managedMarketplaceRoot, "marketplace.json"),
    await readFile(
      join(marketplaceRoot, ".claude-plugin", "marketplace.json"),
      "utf-8",
    ),
    "utf-8",
  );
  await writeFile(
    pluginStoragePath("known_marketplaces.json"),
    `${JSON.stringify(
      {
        version: 1,
        marketplaces: [
          {
            addedAt: "2026-07-31T00:00:00.000Z",
            description: "Deterministic offline CodeFusion marketplace marker",
            id: "cf-plugins-official",
            lastUpdated: "2099-01-01T00:00:00.000Z",
            name: "cf-plugins-official",
            pluginCount: 1,
            source: {
              source: "url",
              url: "https://cdn-cf.z.ai/cf/official-plugin/marketplace.json",
            },
          },
          {
            addedAt: "2026-07-31T00:00:00.000Z",
            description: "Deterministic offline Claude marketplace marker",
            id: "claude-plugins-official",
            lastUpdated: "2099-01-01T00:00:00.000Z",
            name: "claude-plugins-official",
            pluginCount: 1,
            source: {
              repo: "anthropics/claude-plugins-official",
              source: "github",
            },
          },
          {
            addedAt: "2026-07-31T00:00:00.000Z",
            description: "Deterministic PLG12 visual review marketplace",
            id: PLUGIN_LIFECYCLE_MARKETPLACE_ID,
            name: PLUGIN_LIFECYCLE_MARKETPLACE_ID,
            pluginCount: 8,
            source: {
              path: marketplaceRoot,
              source: "directory",
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

async function waitForEnabledSwitchState(enabled: boolean): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (pluginId, expectedState) =>
          document
            .querySelector(
              `[data-testid="plugin-store-enabled-switch"][data-plugin-id="${pluginId}"]`,
            )
            ?.getAttribute("data-state") === expectedState,
        PLUGIN_LIFECYCLE_ID,
        enabled ? "checked" : "unchecked",
      ),
    {
      timeout: 30_000,
      timeoutMsg: `Plugin enabled switch did not become ${enabled}`,
    },
  );
}

async function countCapturedRequestsContaining(marker: string): Promise<number> {
  const capturePath = process.env.E2E_PROVIDER_CAPTURE_PATH?.trim();
  if (!capturePath) return 0;
  try {
    const artifact = JSON.parse(await readFile(capturePath, "utf-8")) as {
      records?: Array<{ requestJson?: unknown }>;
    };
    return (artifact.records ?? []).filter((record) =>
      JSON.stringify(record.requestJson).includes(marker),
    ).length;
  } catch {
    return 0;
  }
}
