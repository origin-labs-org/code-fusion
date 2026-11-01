import { ensureUpstreamProviderForE2E, selectUpstreamModel } from "../helpers/upstream-provider.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../helpers/v4-conversation.js";

describe("E2E_SHARE_POPOVER: Confirm share popover scope", () => {
  it("Cancel rolls back, confirm takes effect; share settings do not replace input area", async function () {
    this.timeout(180_000);
    await browser.waitUntil(
      async () =>
        (await $("[data-testid=onboarding-page]").isDisplayed()) ||
        (await $("[data-testid^=v4-session-pane]").isExisting()),
      { timeout: 30_000 },
    );
    if (await $("[data-testid=onboarding-page]").isDisplayed()) await browser.keys("Escape");
    await ensureUpstreamProviderForE2E({ skipToolbarSelection: true });
    await prepareV4ConversationE2E({ skipProvider: true });
    await selectUpstreamModel();
    for (const suffix of ["one", "two"]) {
      await sendV4Prompt(`E2E_SHARE_POPOVER_${suffix}: reply exactly share-popover-${suffix}`);
      await waitForV4AssistantMessageContaining(`share-popover-${suffix}`);
      await waitForV4ConversationState((state) => state.state === "idle", "Wait for completed turn");
    }
    const trigger = await $("[data-testid=conversation-share-trigger]");
    await trigger.waitForClickable();
    await trigger.click();
    const popover = await $("[data-testid=conversation-share-popover]");
    await popover.waitForDisplayed();
    await $("[data-testid=conversation-share-adjust]").click();
    const panel = await $("[data-testid=conversation-share-selection-panel]");
    await panel.waitForDisplayed();
    const checkbox = await panel.$('[data-conversation-share-selection-item] [role="checkbox"]');
    const all = await panel.$('[data-testid="conversation-share-selection-all"]');
    expect(await all.getAttribute("aria-checked")).toBe("true");
    await all.click();
    expect(await all.getAttribute("aria-checked")).toBe("false");
    expect(await $("[data-testid=conversation-share-selection-apply]").isEnabled()).toBe(false);
    await checkbox.click();
    expect(await all.getAttribute("aria-checked")).toBe("mixed");
    await all.click();
    expect(await all.getAttribute("aria-checked")).toBe("true");

    await panel.$('[data-testid="conversation-share-selection-toggle"]').click();
    expect(await checkbox.getAttribute("data-state")).toBe("unchecked");
    const beforeLocate = await browser.execute(() => {
      const timeline = document.querySelector<HTMLElement>('[data-testid="v4-timeline"]')!;
      return timeline.scrollTop;
    });
    expect(beforeLocate).toBeGreaterThan(100);
    await panel.$('[data-testid="conversation-share-selection-locate"]').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const timeline = document.querySelector<HTMLElement>('[data-testid="v4-timeline"]')!;
          const target = [...timeline.querySelectorAll<HTMLElement>("[data-row-id]")].find((row) =>
            row.textContent?.includes("E2E_SHARE_POPOVER_one"),
          );
          if (!target) return false;
          const top = target.getBoundingClientRect().top - timeline.getBoundingClientRect().top;
          return top >= -1 && top < 50;
        }),
      { timeoutMsg: "First user message should align to top of body viewport after standalone positioning" },
    );
    expect(
      await browser.execute(
        () => document.querySelector<HTMLElement>('[data-testid="v4-timeline"]')!.scrollTop,
      ),
    ).toBeLessThan(beforeLocate);

    expect(await checkbox.getAttribute("data-state")).toBe("unchecked");
    await browser.waitUntil(
      async () =>
        (await $("[data-testid=conversation-share-adjust]").getAttribute("aria-busy")) === "false",
      { timeoutMsg: "Wait for share scope precheck to complete" },
    );
    expect(await $("[data-testid=conversation-share-range-summary]").getText()).toContain("2");
    await $("[data-testid=conversation-share-selection-cancel]").click();
    await panel.waitForDisplayed({ reverse: true });
    await $("[data-testid=conversation-share-adjust]").click();
    await panel.waitForDisplayed();
    expect(
      await panel
        .$('[data-conversation-share-selection-item] [role="checkbox"]')
        .getAttribute("data-state"),
    ).toBe("checked");
    await panel.$('[data-conversation-share-selection-item] [role="checkbox"]').click();
    await $("[data-testid=conversation-share-selection-apply]").waitForClickable();
    await $("[data-testid=conversation-share-selection-apply]").click();
    await panel.waitForDisplayed({ reverse: true });
    await browser.waitUntil(
      async () =>
        (await $("[data-testid=conversation-share-adjust]").getAttribute("aria-busy")) === "false",
      { timeoutMsg: "Wait for share scope precheck to complete" },
    );
    expect(await $("[data-testid=conversation-share-range-summary]").getText()).toContain("1");
    await browser.keys("Escape");
    await popover.waitForDisplayed({ reverse: true });
    await trigger.click();
    await popover.waitForDisplayed();
    await browser.waitUntil(
      async () =>
        (await $("[data-testid=conversation-share-adjust]").getAttribute("aria-busy")) === "false",
      { timeoutMsg: "Wait for share scope precheck to complete" },
    );
    expect(await $("[data-testid=conversation-share-range-summary]").getText()).toContain("1");
  });
});
