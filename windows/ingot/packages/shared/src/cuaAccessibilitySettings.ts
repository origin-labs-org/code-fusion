export type CuaPermissionKind = "accessibility" | "screen_recording";

export interface OpenCuaPermissionOnboardingOptions {
  
  operationId?: string;
  initialPermission?: CuaPermissionKind;
  
  requiredPermissions?: CuaPermissionKind[];
}

export interface CuaAccessibilitySettingsResult {
  success: boolean;
  canceled?: boolean;
  
  sessionId?: string;
  
  returnedFromSettings?: boolean;
  
  restartHelperAfterReturn?: boolean;
  error?: string;
}

export interface PrepareCuaHelperPermissionDragResult {
  success: boolean;
  error?: string;
  helperAppPath?: string;
  helperDisplayName?: string;
  helperBundleId?: string;
}
