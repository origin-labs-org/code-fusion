import type { IPlatformService } from "@origin-ai/cf-shared";

//
function isMacOsDesktopUserAgent(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Macintosh|Mac OS X/.test(navigator.userAgent) &&
    !/iPhone|iPad|iPod/.test(navigator.userAgent)
  );
}

function isWindowsDesktopUserAgent(): boolean {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
}

export function supportsLocalMacCuaPermissionOnboarding(
  platform: Pick<IPlatformService, "openCuaPermissionOnboarding"> | null | undefined,
): boolean {
  return isMacOsDesktopUserAgent() && typeof platform?.openCuaPermissionOnboarding === "function";
}

export function supportsLocalWindowsCuaEntry(
  platform: Pick<IPlatformService, "executeDesktopCommand"> | null | undefined,
): boolean {
  return isWindowsDesktopUserAgent() && typeof platform?.executeDesktopCommand === "function";
}
