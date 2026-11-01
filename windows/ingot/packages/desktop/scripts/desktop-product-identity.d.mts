
export type DesktopProductFlavor = "production" | "preview";

export interface DesktopProductIdentity {
  readonly flavor: DesktopProductFlavor;
  readonly appId: string;
  readonly productName: string;
  readonly linuxExecutableName: string;
  readonly linuxPackageName: string;
  readonly cuaHelperInstallVariant: "preview" | null;
}

export const CF_PREVIEW_IDENTITY_ENV: "CF_PREVIEW_IDENTITY";

export function isPreviewIdentityRequested(env?: Record<string, string | undefined>): boolean;
export function resolveDesktopProductFlavor(
  env?: Record<string, string | undefined>,
): DesktopProductFlavor;
export function resolveDesktopProductIdentity(
  env?: Record<string, string | undefined>,
): DesktopProductIdentity;
export function resolveDesktopArtifactSuffix(env?: Record<string, string | undefined>): string;
export function resolveWindowsAppUserModelIdForFlavor(
  flavor: DesktopProductFlavor,
  runtime?: { isPackaged: boolean },
): string;
export function resolveWindowsAppUserModelId(
  env?: Record<string, string | undefined>,
  runtime?: { isPackaged: boolean },
): string;
export const desktopProductIdentities: Readonly<{
  production: DesktopProductIdentity;
  preview: DesktopProductIdentity;
}>;
