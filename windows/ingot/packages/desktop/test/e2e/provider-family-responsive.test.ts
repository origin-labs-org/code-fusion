import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@origin-ai/cf-shared";
import {
  TID_MODEL_PROVIDER_CONNECTION_MODE_ITEM,
  TID_MODEL_PROVIDER_CONNECTION_MODE_TRIGGER,
  TID_MODEL_PROVIDER_NAV_ITEM,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  readSettings,
  setCurrentElectronRendererContentSize,
  restoreElectronRendererContentSize,
} from "#e2e/helpers/desktop-app";
import { restartIntoWorkspacePreservingProfile } from "#e2e/helpers/model-provider-restart";
import { sel } from "#e2e/helpers/selectors";
import { PROVIDER_RESPONSIVE_TEAM_NAME } from "#e2e/fixtures/provider-family-responsive";

const TEAM_KEY = "team:bigmodel:product-team-a:org-team-a:proj-team-a";
const TEAM_SELECTION = {
  kind: "team-coding-plan",
  productId: "product-team-a",
  organizationId: "org-team-a",
  projectId: "proj-team-a",
};

async function captureEvidence(label: string) {
  const directory =
    process.env.CF_E2E_ARTIFACT_DIR ||
    join(process.cwd(), ".e2e-artifacts", "provider-responsive");
  await mkdir(directory, { recursive: true });
  await browser.saveScreenshot(join(directory, `provider-responsive-${label}.png`));
}

async function visible(testID: string) {
  await browser.waitUntil(
    async () => {
      for (const element of await $$(sel(testID))) {
        if (await element.isDisplayed()) return true;
      }
      return false;
    },
    { timeout: 30000, timeoutMsg: `未Show ${testID}` },
  );
  for (const element of await $$(sel(testID))) {
    if (await element.isDisplayed()) return element;
  }
  throw new Error(`可见元素已消失：${testID}`);
}

async function openProviderSettings() {
  await (await visible(TID_TASK_SETTINGS_BUTTON)).click();
  await (await visible(TID_SETTINGS_PAGE)).waitForDisplayed();
  await (await visible(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"))).click();
  await browser.waitUntil(
    async () =>
      (await $(`${sel(TID_SETTINGS_PAGE)} button[aria-busy]`).getAttribute("aria-busy")) ===
      "false",
    { timeout: 30000, timeoutMsg: "Initial refresh for model provider has not finished" },
  );
}

async function setScenario(enabled: boolean) {
  const baseUrl = process.env.CF_CODING_PLAN_TEAM_MOCK_BASE_URL;
  assert.ok(baseUrl, "Missing mock URL for plan service");
  const response = await fetch(`${baseUrl}/__e2e/coding-plan/scenario`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario: "both", providerResponsive: enabled }),
  });
  assert.equal(response.status, 200);
}

describe("Provider real-world app responsive regression", () => {
  it("CTP-12: Long team name wide/narrow layouts, standalone Start navigation, and team selection persistence", async function () {
    this.timeout(180000);
    await setScenario(true);
    await restartIntoWorkspacePreservingProfile();
    const viewportHeight = 800;
    const originalSize = await setCurrentElectronRendererContentSize(1800, viewportHeight);
    try {
      await openProviderSettings();
      await (await visible(TID_MODEL_PROVIDER_CONNECTION_MODE_TRIGGER)).click();
      await (await visible(testId(TID_MODEL_PROVIDER_CONNECTION_MODE_ITEM, TEAM_KEY))).click();
      await browser.waitUntil(
        async () => {
          const selection = (await readSettings()).providerFamilyConnectionSelections?.bigmodel;
          return (
            selection?.kind === "team-coding-plan" &&
            selection.productId === TEAM_SELECTION.productId &&
            selection.organizationId === TEAM_SELECTION.organizationId &&
            selection.projectId === TEAM_SELECTION.projectId
          );
        },
        { timeout: 10000, timeoutMsg: "团队选择没有持久化" },
      );

      for (const width of [1800, 480]) {
        await setCurrentElectronRendererContentSize(width, viewportHeight);
        const trigger = await visible(TID_MODEL_PROVIDER_CONNECTION_MODE_TRIGGER);
        await expect(trigger).toHaveText(PROVIDER_RESPONSIVE_TEAM_NAME);
        await browser.execute(async () => {
          await document.fonts.ready;
        });
        const geometry = await browser.execute((triggerId) => {
          const trigger = [
            ...document.querySelectorAll<HTMLElement>(`[data-testid="${triggerId}"]`),
          ].find((node) => node.getBoundingClientRect().width > 0)!;
          const rect = trigger.getBoundingClientRect();
          const controls = trigger.parentElement!;
          const header = controls.parentElement!.parentElement!;
          const title = header.querySelector("h3")!.getBoundingClientRect();
          const value = trigger.querySelector('[data-slot="select-value"]')!
            .firstElementChild as HTMLElement;
          const arrow = trigger.querySelector("svg")!.getBoundingClientRect();
          return {
            viewport: innerWidth,
            pageWidth: document.documentElement.scrollWidth,
            left: rect.left,
            right: rect.right,
            panelRight: header.getBoundingClientRect().right,
            arrowLeft: arrow.left,
            arrowRight: arrow.right,
            textWidth: value.clientWidth,
            fullTextWidth: value.scrollWidth,
            overflow: getComputedStyle(value).textOverflow,
            sameRow: rect.top < title.bottom && rect.bottom > title.top,
          };
        }, TID_MODEL_PROVIDER_CONNECTION_MODE_TRIGGER);
        console.log("E2E_PROVIDER_RESPONSIVE_GEOMETRY", width, JSON.stringify(geometry));
        await captureEvidence(String(width));
        assert.ok(geometry.right <= geometry.panelRight + 1, "选择框超出面板");
        assert.ok(geometry.pageWidth <= geometry.viewport, "Horizontal page overflow");
        assert.ok(
          geometry.arrowLeft >= geometry.left && geometry.arrowRight <= geometry.right,
          "箭头被裁切",
        );
        assert.equal(geometry.overflow, "ellipsis");
        if (width === 1800) {
          assert.ok(geometry.fullTextWidth <= geometry.textWidth + 1, "Wide screen should prioritize displaying the full name");
          assert.ok(geometry.sameRow, "Action area should not wrap as a whole group on wide screens");
        } else {
          assert.ok(
            geometry.fullTextWidth > geometry.textWidth + 1,
            "Narrow screen test case must actually trigger name ellipsis",
          );
        }
        assert.equal(await $(sel("model-provider-start-plan-switch-prefix")).isExisting(), false);
      }

      await setCurrentElectronRendererContentSize(1200, viewportHeight);
      await (
        await visible(
          testId(
            TID_MODEL_PROVIDER_NAV_ITEM,
            `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan}`,
          ),
        )
      ).click();
      await expect($(sel(TID_SETTINGS_PAGE)).$("h3=Start Plan")).toBeDisplayed();
      expect(await $(sel(TID_MODEL_PROVIDER_CONNECTION_MODE_TRIGGER)).isExisting()).toBe(false);
      assert.deepEqual(
        (await readSettings()).providerFamilyConnectionSelections?.bigmodel,
        TEAM_SELECTION,
      );
      await captureEvidence("independent-start");
      await (await visible(TID_SETTINGS_BACK_BUTTON)).click();
      await openProviderSettings();
      await (
        await visible(
          testId(
            TID_MODEL_PROVIDER_NAV_ITEM,
            `preset:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan}`,
          ),
        )
      ).click();
      await expect(await visible(TID_MODEL_PROVIDER_CONNECTION_MODE_TRIGGER)).toHaveText(
        PROVIDER_RESPONSIVE_TEAM_NAME,
      );
      assert.deepEqual(
        (await readSettings()).providerFamilyConnectionSelections?.bigmodel,
        TEAM_SELECTION,
      );
      const response = await fetch(
        `${process.env.CF_CODING_PLAN_TEAM_MOCK_BASE_URL}/__e2e/coding-plan/requests`,
      );
      assert.equal(response.status, 200);
      const payload = (await response.json()) as { requests: Array<{ path: string }> };
      for (const path of [
        "/api/biz/customer/getCustomerInfo",
        "/api/biz/subscription/enterprise/v2/pricing",
        "/api/v1/cf-plan/billing/balance",
      ]) {
        assert.ok(
          payload.requests.some((request) => request.path === path),
          `应用未Request ${path}`,
        );
      }
      await captureEvidence("persisted-team");
    } finally {
      await restoreElectronRendererContentSize(originalSize);
      await setScenario(false);
    }
  });
});
