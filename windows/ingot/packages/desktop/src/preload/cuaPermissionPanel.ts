
import { contextBridge, ipcRenderer } from "electron";
import { PlatformChannels, type CuaPermissionKind, type Locale } from "@origin-ai/cf-shared";

const CUA_PERMISSION_PANEL_STATE_CHANNEL = "cf:cua-permission-panel-state";

interface CuaPermissionPanelState {
  permission: CuaPermissionKind;
  
  locale: Locale;
  
  iconDataUrl: string | null;
}

contextBridge.exposeInMainWorld("cuaPermissionPanel", {
  
  prepareDrag: () => ipcRenderer.invoke(PlatformChannels.PrepareCuaHelperPermissionDrag),
  
  startDrag: () => ipcRenderer.send(PlatformChannels.StartCuaHelperPermissionDrag),
  
  notifyDragEnded: () => ipcRenderer.send(PlatformChannels.NotifyCuaHelperPermissionDragEnded),
  
  onState: (callback: (state: CuaPermissionPanelState) => void) => {
    const listener = (_event: unknown, payload: CuaPermissionPanelState) => callback(payload);
    ipcRenderer.on(CUA_PERMISSION_PANEL_STATE_CHANNEL, listener);
    return () => ipcRenderer.removeListener(CUA_PERMISSION_PANEL_STATE_CHANNEL, listener);
  },
});
