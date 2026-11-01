
export const CF_PREVIEW_IDENTITY_ENV = "CF_PREVIEW_IDENTITY";

const PRODUCTION_IDENTITY = Object.freeze({
  flavor: "production",
  appId: "dev.cf.app",
  productName: "CodeFusion IDE",
  linuxExecutableName: "cf",
  linuxPackageName: "cf",
  cuaHelperInstallVariant: null,
});

const PREVIEW_IDENTITY = Object.freeze({
  flavor: "preview",
  appId: "dev.cf.app.preview",
  productName: "CodeFusion IDE Preview",
  linuxExecutableName: "cf-preview",
  linuxPackageName: "cf-preview",
  cuaHelperInstallVariant: "preview",
});

export const desktopProductIdentities = Object.freeze({
  production: PRODUCTION_IDENTITY,
  preview: PREVIEW_IDENTITY,
});

function normalizeDesktopCfEnv(env) {
  return env.CF_ENV?.trim().toLowerCase() === "production" ? "production" : "test";
}

export function isPreviewIdentityRequested(env = process.env) {
  const value = env[CF_PREVIEW_IDENTITY_ENV]?.trim() ?? "";
  if (value === "1") {
    return true;
  }
  if (value === "" || value === "0") {
    return false;
  }
  throw new Error(
    `invalid ${CF_PREVIEW_IDENTITY_ENV}=${env[CF_PREVIEW_IDENTITY_ENV]}; expected 1 or 0`,
  );
}

export function resolveDesktopProductFlavor(env = process.env) {
  if (isPreviewIdentityRequested(env)) {
    return "preview";
  }
  return normalizeDesktopCfEnv(env) === "production" ? "production" : "preview";
}

export function resolveDesktopProductIdentity(env = process.env) {
  return desktopProductIdentities[resolveDesktopProductFlavor(env)];
}

export function resolveDesktopArtifactSuffix(env = process.env) {
  return normalizeDesktopCfEnv(env) === "test" ? "_TEST" : "";
}

export function resolveWindowsAppUserModelIdForFlavor(flavor, runtime = { isPackaged: true }) {
  if (runtime.isPackaged === false) {
    return "dev.cf.app.dev";
  }
  return desktopProductIdentities[flavor === "preview" ? "preview" : "production"].appId;
}

export function resolveWindowsAppUserModelId(env = process.env, runtime = { isPackaged: true }) {
  return resolveWindowsAppUserModelIdForFlavor(resolveDesktopProductFlavor(env), runtime);
}
