
export function isTransientScreenshotCaptureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UnknownVizError");
}

export interface ScreenshotTransientRetryContext {
  target: "owner" | "guest";
  windowId: number;
  webContentsId: number;
}

const TRANSIENT_CAPTURE_RETRY_DELAY_MS = 100;
const TRANSIENT_CAPTURE_RETRY_BUDGET_MS = 2_000;

export class DesktopBrowserScreenshotTransientRetry {
  private startedAt: number | undefined;
  private attempts = 0;

  constructor(
    private readonly options: {
      delayMs?: number;
      budgetMs?: number;
      log?(message: string): void;
    } = {},
  ) {}

  retryDelayMs(): number {
    return this.options.delayMs ?? TRANSIENT_CAPTURE_RETRY_DELAY_MS;
  }

  
  schedule(context: ScreenshotTransientRetryContext): boolean {
    this.startedAt ??= Date.now();
    this.attempts += 1;
    if (
      Date.now() - this.startedAt >=
      (this.options.budgetMs ?? TRANSIENT_CAPTURE_RETRY_BUDGET_MS)
    ) {
      this.options.log?.(
        `[browser-screenshot-activity] transient capture retry budget exhausted target=${context.target} windowId=${context.windowId} webContentsId=${context.webContentsId} attempts=${this.attempts}`,
      );
      return false;
    }
    this.options.log?.(
      `[browser-screenshot-activity] transient capture retry scheduled target=${context.target} windowId=${context.windowId} webContentsId=${context.webContentsId} attempt=${this.attempts} delayMs=${this.retryDelayMs()}`,
    );
    return true;
  }

  reset(): void {
    this.startedAt = undefined;
    this.attempts = 0;
  }
}
