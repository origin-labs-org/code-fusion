import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ConsoleMessage, Page, Request } from "playwright-core";

function publicUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

export function redactMobileDiagnosticText(text: string, pairingUrl: string): string {
  const url = new URL(pairingUrl);
  const values = [
    ...url.searchParams.values(),
    ...new URLSearchParams(url.hash.slice(1)).values(),
    url.hash.slice(1),
  ];
  let result = text.split(pairingUrl).join(publicUrl(pairingUrl));
  for (const value of values) {
    if (value.length < 4) continue;
    result = result.split(value).join("<REDACTED>");
  }
  return result.replace(/https?:\/\/[^\s"'<>]+/gu, publicUrl);
}

export async function openMobilePairingPage(
  page: Page,
  pairingUrl: string,
  options: { artifactDir: string; caseMarker: string; phase: string; readySelector: string },
): Promise<void> {
  const redact = (value: string) => redactMobileDiagnosticText(value, pairingUrl);
  const failures: string[] = [];
  const record = (value: string) => {
    if (failures.length < 50) failures.push(redact(value));
  };
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === "error") record(message.text());
  };
  const onPageError = (error: Error) => record(error.message);
  const onRequestFailed = (request: Request) =>
    record(`${publicUrl(request.url())}: ${request.failure()?.errorText ?? "request failed"}`);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  try {
    await page.goto(pairingUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const connected = page.locator(options.readySelector);
    const onboarding = page.getByTestId("onboarding-page");
    await connected.or(onboarding).first().waitFor({ timeout: 60_000 });
    if (await onboarding.isVisible()) {
      for (const step of [1, 2, 3]) {
        await onboarding
          .locator('li[aria-current="step"]')
          .filter({ hasText: `${step}.` })
          .waitFor();
        await onboarding.getByRole("button", { name: /^(Skip|Skip)$/u }).click();
      }
      await page.waitForFunction(() => {
        const onboarding = document.querySelector('[data-testid="onboarding-page"]');
        return (
          !onboarding ||
          Array.from(onboarding.querySelectorAll("button")).some(
            (button) =>
              /^(Get started|Get started)$/u.test(button.textContent?.trim() ?? "") &&
              !button.disabled,
          )
        );
      });
      if (await onboarding.isVisible()) {
        const saveError = onboarding.getByRole("alert");
        if (await saveError.isVisible()) {
          throw new Error(`首次Onboarding偏OKSaveFailed：${await saveError.textContent()}`);
        }
        await onboarding.getByRole("button", { name: /ExitOnboarding|Exit onboarding/u }).click();
      }
      await onboarding.waitFor({ state: "hidden", timeout: 30_000 });
    }
    await connected.waitFor({ timeout: 60_000 });
  } catch (error) {
    const prefix = resolve(
      options.artifactDir,
      `mobile-${options.phase.replace(/[^a-z0-9-]/giu, "-")}`,
    );
    try {
      await mkdir(options.artifactDir, { recursive: true });
      const snapshot = await page.evaluate(() => ({
        title: document.title,
        text: (document.body?.innerText ?? "").slice(0, 6000),
        testIds: Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).map(
          (node) => node.dataset.testid,
        ),
        scripts: Array.from(document.scripts)
          .map((node) => node.src)
          .filter(Boolean),
      }));
      await writeFile(
        `${prefix}.json`,
        JSON.stringify(
          {
            url: publicUrl(page.url()),
            ...snapshot,
            text: redact(snapshot.text),
            scripts: snapshot.scripts.map(publicUrl),
            failures,
          },
          null,
          2,
        ),
      );
      await page.screenshot({ path: `${prefix}.png`, fullPage: true });
    } catch (captureError) {
      record(`Diagnostics采集Failed: ${String(captureError)}`);
    }
    throw new Error(
      `${options.caseMarker}: 手机配对Failed；${redact(String(error))}；${failures.join(" | ")}`,
    );
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("requestfailed", onRequestFailed);
  }
}
