interface DarwinCloseAwareWindow {
  isFullScreen(): boolean;
  setFullScreen(flag: boolean): void;
  hide(): void;
}

export function handleDarwinWindowCloseRequest(options: {
  win: DarwinCloseAwareWindow;
  forceQuit: boolean;
  label: string;
  logger: { info: (...args: unknown[]) => void };
}): boolean {
  if (options.forceQuit) {
    return false;
  }

  if (options.win.isFullScreen()) {
    options.win.setFullScreen(false);
    options.logger.info(
      `[createWindow] fullscreen close converted to leave-full-screen (${options.label})`,
    );
    return true;
  }

  options.win.hide();
  options.logger.info(`[createWindow] window hidden instead of closed (${options.label})`);
  return true;
}
