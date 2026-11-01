import type { ReactNode } from "react";
import { AlertDialogHost } from "@/AlertDialogHost.js";
import { ConfirmDialogHost } from "@/ConfirmDialog.js";
import { CuaPermissionObservationAttachment } from "@/cua-permission/CuaPermissionObservationAttachment.js";
import { PluginUiBackgroundHost, PluginUiFollowUpDialogHost } from "@/plugin-ui/index.js";

export function RootShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-dvh">
      {children}
      <CuaPermissionObservationAttachment />
      <AlertDialogHost />
      <ConfirmDialogHost />
      <PluginUiFollowUpDialogHost />
      <PluginUiBackgroundHost />
    </div>
  );
}
