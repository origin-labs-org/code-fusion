import { BrowserWindow, ipcMain } from "electron";
import { DesktopCommandIds, PlatformChannels, type DesktopCommandId } from "@origin-ai/cf-shared";

export function registerDesktopCommandIpcHandler(options: {
  executeDesktopCommand: (
    command: DesktopCommandId,
    senderWindow?: BrowserWindow | null,
  ) => Promise<unknown>;
  logger: {
    warn: (...args: unknown[]) => void;
  };
}): void {
  ipcMain.handle(PlatformChannels.ExecuteDesktopCommand, async (event, command: string) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const isKnownCommand = (Object.values(DesktopCommandIds) as string[]).includes(command);
    if (!isKnownCommand) {
      options.logger.warn("[desktop-command] invalid command:", command);
      return;
    }

    return options.executeDesktopCommand(command as DesktopCommandId, senderWindow);
  });
}
