

import { ipcMain } from "electron";
import { PlatformChannels, rendererHeapSampleSchema } from "@origin-ai/cf-shared";
import type { ProcessResourceSampleSource } from "./processResourceSampleSources.js";
import { isMainApplicationWindowWebContents } from "./resourceManagerWindow.js";

const pendingHeapUsedKb = new Map<number, number>();

export function ingestRendererHeapSample(webContentsId: number, raw: unknown): void {
  if (!isMainApplicationWindowWebContents(webContentsId)) {
    return;
  }
  const parsed = rendererHeapSampleSchema.safeParse(raw);
  if (!parsed.success) {
    return;
  }
  pendingHeapUsedKb.set(webContentsId, parsed.data.heapUsedKb);
}

export function registerRendererHeapSampleIpc(): void {
  ipcMain.removeAllListeners(PlatformChannels.ReportRendererHeapSample);
  ipcMain.on(PlatformChannels.ReportRendererHeapSample, (event, payload: unknown) => {
    ingestRendererHeapSample(event.sender.id, payload);
  });
}

export const rendererHeapProcessResourceSampleSource: ProcessResourceSampleSource = {
  id: "renderer_heap",
  sample(context) {
    const arrivedHeapUsedKb = [...pendingHeapUsedKb.values()];
    pendingHeapUsedKb.clear();
    if (arrivedHeapUsedKb.length === 0) {
      return;
    }
    
    context.addRoleHeapSample("renderer_main", Math.max(...arrivedHeapUsedKb));
  },
  reset() {
    pendingHeapUsedKb.clear();
  },
};
