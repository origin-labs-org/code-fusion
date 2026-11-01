import { access, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, posix } from "node:path";

export const DEV_ELECTRON_PROTOCOL_SCHEME = "cf";
export const DEV_ELECTRON_APP_NAME = "CodeFusion Dev";
export const DEV_ELECTRON_APP_BUNDLE_ID = "dev.cf.app.development";
export const DEV_ELECTRON_BUNDLE_FORMAT = 2;

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

function replacePlistString(plist, key, value) {
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`, "u");
  if (!pattern.test(plist)) {
    throw new Error(`Dev Electron Info.plist is missing ${key}`);
  }
  return plist.replace(
    pattern,
    (_match, prefix, suffix) => `${prefix}${escapeXml(value)}${suffix}`,
  );
}

function appendProtocolDeclaration(plist) {
  if (plist.includes(`<string>${DEV_ELECTRON_PROTOCOL_SCHEME}</string>`)) {
    return plist;
  }

  const closingDictIndex = plist.lastIndexOf("</dict>");
  if (closingDictIndex < 0) {
    throw new Error("Dev Electron Info.plist is missing its root dict");
  }

  const protocolDeclaration = `\n\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>${DEV_ELECTRON_APP_NAME}</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${DEV_ELECTRON_PROTOCOL_SCHEME}</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n`;
  return `${plist.slice(0, closingDictIndex)}${protocolDeclaration}${plist.slice(closingDictIndex)}`;
}

export function patchDevElectronInfoPlist(plist) {
  let patched = replacePlistString(plist, "CFBundleDisplayName", DEV_ELECTRON_APP_NAME);
  patched = replacePlistString(patched, "CFBundleIdentifier", DEV_ELECTRON_APP_BUNDLE_ID);
  patched = replacePlistString(patched, "CFBundleName", DEV_ELECTRON_APP_NAME);
  return appendProtocolDeclaration(patched);
}

export function resolveDevElectronAppBundlePath({ runtimeRoot, electronVersion, arch }) {
  return posix.join(runtimeRoot, `${electronVersion}-${arch}`, `${DEV_ELECTRON_APP_NAME}.app`);
}

export async function prepareDevElectronAppBundle({
  electronAppPath,
  runtimeRoot,
  electronVersion,
  arch,
}) {
  const appPath = resolveDevElectronAppBundlePath({ runtimeRoot, electronVersion, arch });
  const infoPlistPath = posix.join(appPath, "Contents", "Info.plist");
  const sourceExecutablePath = posix.join(electronAppPath, "Contents", "MacOS", "Electron");
  const existingExecutablePath = posix.join(appPath, "Contents", "MacOS", "Electron");
  const sourceStampPath = posix.join(dirname(appPath), ".cf-dev-electron-source.json");
  //
  //
  const sourceStats = await stat(sourceExecutablePath).catch(() => undefined);
  const sourceStamp = sourceStats
    ? JSON.stringify({
        format: DEV_ELECTRON_BUNDLE_FORMAT,
        size: sourceStats.size,
        mtimeMs: sourceStats.mtimeMs,
      })
    : undefined;
  let needsCopy = true;
  try {
    const existingInfoPlist = await readFile(infoPlistPath, "utf8");
    await access(existingExecutablePath);
    const existingStamp = await readFile(sourceStampPath, "utf8");
    needsCopy =
      !existingInfoPlist.includes(`<string>${DEV_ELECTRON_APP_BUNDLE_ID}</string>`) ||
      !existingInfoPlist.includes(`<string>${DEV_ELECTRON_PROTOCOL_SCHEME}</string>`) ||
      sourceStamp === undefined ||
      existingStamp !== sourceStamp;
  } catch {
  }

  if (needsCopy) {
    await rm(appPath, { recursive: true, force: true });
    await rm(sourceStampPath, { force: true });
    await mkdir(dirname(appPath), { recursive: true });
    await cp(electronAppPath, appPath, { recursive: true, verbatimSymlinks: true });
    const patchedInfoPlist = patchDevElectronInfoPlist(await readFile(infoPlistPath, "utf8"));
    await writeFile(infoPlistPath, patchedInfoPlist, "utf8");
    if (sourceStamp !== undefined) await writeFile(sourceStampPath, sourceStamp, "utf8");
  }

  return {
    appPath,
    executablePath: posix.join(appPath, "Contents", "MacOS", "Electron"),
  };
}
