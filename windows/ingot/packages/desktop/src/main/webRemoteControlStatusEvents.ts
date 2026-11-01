import { PlatformChannels, type WebRemoteControlStatus } from "@origin-ai/cf-shared";

interface WebRemoteControlStatusEventTarget {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    send(channel: string, status: WebRemoteControlStatus): void;
  };
}

export function sendWebRemoteControlStatusChangedToWindow(
  targetWindow: WebRemoteControlStatusEventTarget | null | undefined,
  status: WebRemoteControlStatus,
): void {
  if (
    !targetWindow ||
    targetWindow.isDestroyed() ||
    targetWindow.webContents.isDestroyed()
  ) {
    return;
  }

  targetWindow.webContents.send(PlatformChannels.WebRemoteControlStatusChanged, status);
}
