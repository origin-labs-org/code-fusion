import { contextBridge, ipcRenderer } from "electron";
import { PlatformChannels, formatCfRendererProcessName } from "@origin-ai/cf-shared";
import type {
  ResourceUsageSnapshot,
  NetworkCaptureBridge,
  StorageCleanRequest,
  StorageCleanResult,
  StorageManagementBridge,
  StorageUsageSnapshot,
} from "@origin-ai/cf-shared";

process.title = formatCfRendererProcessName("Resource Manager");

const storage: StorageManagementBridge = {
  startScan: (): Promise<{ jobId: string }> =>
    ipcRenderer.invoke(PlatformChannels.StorageStartScan),
  cancelScan: (jobId: string): Promise<void> =>
    ipcRenderer.invoke(PlatformChannels.StorageCancelScan, jobId),
  getSnapshot: (): Promise<StorageUsageSnapshot | null> =>
    ipcRenderer.invoke(PlatformChannels.StorageGetSnapshot),
  clean: (request: StorageCleanRequest): Promise<StorageCleanResult> =>
    ipcRenderer.invoke(PlatformChannels.StorageClean, request),
  revealPath: (absolutePath: string): Promise<void> =>
    ipcRenderer.invoke(PlatformChannels.StorageRevealPath, absolutePath),
  subscribeScanProgress: (listener) => {
    const handler = (_event: unknown, snapshot: StorageUsageSnapshot) => listener(snapshot);
    ipcRenderer.on(PlatformChannels.StorageScanProgress, handler);
    return () => ipcRenderer.removeListener(PlatformChannels.StorageScanProgress, handler);
  },
};

const network: NetworkCaptureBridge = {
  getSnapshot: () => ipcRenderer.invoke(PlatformChannels.GetNetworkCaptureSnapshot),
  clear: () => ipcRenderer.invoke(PlatformChannels.ClearNetworkCapture),
};

contextBridge.exposeInMainWorld("resourceManager", {
  setSamplingActive: (active: boolean): void =>
    ipcRenderer.send(PlatformChannels.SetResourceUsageSamplingActive, active),
  getSnapshot: (): Promise<ResourceUsageSnapshot> =>
    ipcRenderer.invoke(PlatformChannels.GetResourceUsageSnapshot),
  storage,
  network,
});
