
export async function assertOverlayWindowControls(surfaceSelector: string) {
  const inline = await browser.execute(() =>
    ["platform-windows-desktop", "platform-linux-desktop"].some((name) =>
      document.documentElement.classList.contains(name),
    ),
  );
  for (const id of ["minimize", "maximize", "close"]) {
    const selector = `${surfaceSelector} [data-testid="window-control-${id}"]`;
    const button = await $(selector);
    expect(await button.isDisplayed()).toBe(inline);
    if (inline) {
      expect(
        await browser.execute(
          (targetSelector, rootSelector) => {
            const element = document.querySelector(targetSelector)!;
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );
            const overlappingDrag = Array.from(
              document.querySelector(rootSelector)!.querySelectorAll("div"),
            ).some((candidate) => {
              if (candidate.contains(element)) return false;
              if (getComputedStyle(candidate).getPropertyValue("-webkit-app-region") !== "drag")
                return false;
              const drag = candidate.getBoundingClientRect();
              return (
                drag.left < rect.right &&
                drag.right > rect.left &&
                drag.top < rect.bottom &&
                drag.bottom > rect.top
              );
            });
            return (hit === element || element.contains(hit)) && !overlappingDrag;
          },
          selector,
          surfaceSelector,
        ),
      ).toBe(true);
    }
  }
}
