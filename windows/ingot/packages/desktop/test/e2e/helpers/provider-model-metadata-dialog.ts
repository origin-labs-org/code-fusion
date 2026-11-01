export async function saveProviderModelMetadataDialog(label: string) {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        const saveButton = Array.from(
          dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        ).find((button) => {
          const text = button.innerText.replace(/\s+/g, " ").trim();
          return text === "保存" || text.startsWith("Save");
        });
        if (!saveButton || saveButton.disabled || dialog?.querySelector('[role="status"]')) {
          return false;
        }
        saveButton.click();
        return true;
      }),
    {
      timeout: 15000,
      timeoutMsg: `New增 ${label} Model metadata Save按钮没有结束 catalog Query并进入可点击Status`,
    },
  );
  await browser.waitUntil(
    () => browser.execute(() => !document.querySelector<HTMLElement>('[role="dialog"]')),
    {
      timeout: 10000,
      timeoutMsg: `New增 ${label} Model metadata modal did not close after saving`,
    },
  );
}
