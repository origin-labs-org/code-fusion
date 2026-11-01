import { createRoot } from "react-dom/client";
import { Button } from "@origin-ai/cf-ui/button";
import { resolveWebRemoteControlScreenLocale } from "#src/web-remote-control/ui/webRemoteControlFailureScreen.js";

export function showWebRemoteControlVersionNotice(
  version: string,
  onReload: () => void,
): () => void {
  const dialog = document.createElement("dialog");
  dialog.className =
    "m-auto max-w-md rounded-2xl border border-popover-border bg-popover p-6 text-foreground shadow-lg";
  dialog.style.width = "calc(100% - 2rem)";
  dialog.style.pointerEvents = "auto";
  dialog.setAttribute("aria-labelledby", "remote-version-title");
  dialog.setAttribute("aria-describedby", "remote-version-description");
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  const zh = resolveWebRemoteControlScreenLocale(navigator.language) === "zh-CN";
  document.body.append(dialog);
  const noticeRoot = createRoot(dialog);
  noticeRoot.render(
    <div className="flex min-w-0 flex-col gap-4">
      <h2 id="remote-version-title" className="text-ui-lg font-medium">
        {zh ? "DesktopVersion已更New" : "Desktop version changed"}
      </h2>
      <p
        id="remote-version-description"
        className="text-ui-base text-foreground-subtle break-words"
      >
        {zh
          ? `DesktopCurrentVersion为 ${version}。Task操作已暂停，请Reload以Continue。未Send的Attachment不会Retain。`
          : `The desktop is now running ${version}. Task controls are paused. Reload to continue. Unsent attachments will not be retained.`}
      </p>
      <Button autoFocus size="lg" className="self-end" onClick={onReload}>
        {zh ? "重新加载" : "Reload"}
      </Button>
    </div>,
  );
  dialog.showModal();
  for (const type of [
    "keydown",
    "keyup",
    "keypress",
    "click",
    "pointerdown",
    "focusin",
    "focusout",
  ] as const) {
    dialog.addEventListener(type, (event) => event.stopPropagation());
  }
  return () => {
    noticeRoot.unmount();
    dialog.close();
    dialog.remove();
  };
}
