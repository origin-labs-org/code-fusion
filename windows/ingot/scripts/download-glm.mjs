//

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";
import { resolveIntranetDepsBaseUrl } from "./intranetDefaults.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(__dirname, "..");

function readCfAgentRuntimeVersion() {
  const runtimeSourcePath = path.join(REPO_ROOT, "packages/shared/src/cf-agent-runtime.ts");
  const runtimeSource = fs.readFileSync(runtimeSourcePath, "utf8");
  const match = runtimeSource.match(/version:\s*["']([^"']+)["']/);
  if (!match?.[1]) {
    throw new Error("Unable to parse CodeFusion Agent runtime version");
  }
  return match[1];
}

export const GLM_RUNTIME_VERSION = readCfAgentRuntimeVersion();
function resolveDefaultGlmBinaryDownloadBaseUrl(env = process.env) {
  return `${resolveIntranetDepsBaseUrl(env)}/cf-cli-${GLM_RUNTIME_VERSION}`;
}

function normalizePlatform(raw) {
  switch (raw) {
    case "mac":
    case "macos":
    case "darwin":
    case "osx":
      return "darwin";
    case "win":
    case "windows":
    case "win32":
      return "win32";
    case "linux":
      return "linux";
    default:
      return raw;
  }
}

function normalizeArch(raw) {
  switch (raw) {
    case "x86_64":
    case "x64":
    case "amd64":
      return "x64";
    case "aarch64":
    case "arm64":
      return "arm64";
    default:
      return raw;
  }
}

function detectPlatform() {
  const s =
    process.platform === "win32" ? "win32" : execSync("uname -s").toString().trim().toLowerCase();
  return normalizePlatform(s);
}

function detectArch() {
  const m =
    process.arch === "x64"
      ? "x64"
      : process.arch === "arm64"
        ? "arm64"
        : execSync("uname -m").toString().trim();
  return normalizeArch(m);
}

export function resolveGlmDownloadName(platform, arch) {
  if (platform === "win32") {
    return `cf-windows-${arch}.exe`;
  }

  return `cf-${platform}-${arch}`;
}

export function resolveGlmDownloadBaseUrl(env = process.env) {
  return env.GLM_BINARY_DOWNLOAD_BASE_URL || resolveDefaultGlmBinaryDownloadBaseUrl(env);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null;
}

export function isGlmBundleMetaMatch(meta, expected) {
  if (!isPlainObject(meta)) {
    return false;
  }

  const provider = typeof meta.provider === "string" ? meta.provider : null;
  const version = typeof meta.version === "string" ? meta.version : null;
  const platform = typeof meta.platform === "string" ? meta.platform : null;
  const source = typeof meta.source === "string" ? meta.source : null;

  return (
    provider === "glm" &&
    version === expected.version &&
    platform === expected.platform &&
    source === expected.source
  );
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeGlmBundleMeta(outputDir, expectedMeta) {
  const metadata = JSON.stringify(
    {
      provider: "glm",
      version: expectedMeta.version,
      platform: expectedMeta.platform,
      source: expectedMeta.source,
    },
    null,
    2,
  );
  fs.writeFileSync(path.join(outputDir, ".bundle-meta.json"), `${metadata}\n`, "utf8");
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(dest);
    mod
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

export async function main() {
  const platform =
    normalizePlatform(process.argv[2] || process.env.CF_TARGET_OS || "") || detectPlatform();
  const arch =
    normalizeArch(process.argv[3] || process.env.CF_TARGET_ARCH || "") || detectArch();
  const forceRemoteOutput = process.env.CF_FORCE_REMOTE_MOCK_CDN === "1";

  const localPlatform = normalizePlatform(process.env.CF_TARGET_OS || "") || detectPlatform();
  const localArch = normalizeArch(process.env.CF_TARGET_ARCH || "") || detectArch();

  const platformKey = `${platform}-${arch}`;
  const localKey = `${localPlatform}-${localArch}`;

  const repoRoot = REPO_ROOT;

  const localOutputDir = path.join(repoRoot, "packages/desktop/bundled-agents", platformKey, "glm");
  const version = require(path.join(repoRoot, "package.json")).version;
  const remoteOutputDir = path.join(
    repoRoot,
    "packages/desktop/mock-cdn/releases",
    version,
    "glm",
    platformKey,
  );
  const outputDir = forceRemoteOutput
    ? remoteOutputDir
    : platformKey === localKey
      ? localOutputDir
      : remoteOutputDir;

  const binaryName = platform === "win32" ? "cf-agent.exe" : "cf-agent";
  const binaryPath = path.join(outputDir, binaryName);

  const baseUrl = resolveGlmDownloadBaseUrl();
  const downloadUrl = `${baseUrl}/${resolveGlmDownloadName(platform, arch)}`;
  const expectedMeta = {
    version: GLM_RUNTIME_VERSION,
    platform: platformKey,
    source: downloadUrl,
  };
  const metadataPath = path.join(outputDir, ".bundle-meta.json");

  console.log("==> glm binary download");
  console.log(`    version:  v${expectedMeta.version}`);
  console.log(`    platform: ${platformKey}`);
  console.log(`    target:   ${binaryPath}`);

  if (fs.existsSync(binaryPath)) {
    const existingMeta = readJsonFile(metadataPath);
    if (isGlmBundleMetaMatch(existingMeta, expectedMeta)) {
      console.log(`    [skip] 已存在 glm v${expectedMeta.version}，Skip`);
      process.exit(0);
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });

  if (forceRemoteOutput) {
    const bundledBinaryPath = path.join(localOutputDir, binaryName);
    const bundledMetadataPath = path.join(localOutputDir, ".bundle-meta.json");
    const bundledMeta = readJsonFile(bundledMetadataPath);
    if (fs.existsSync(bundledBinaryPath) && isGlmBundleMetaMatch(bundledMeta, expectedMeta)) {
      fs.copyFileSync(bundledBinaryPath, binaryPath);
      writeGlmBundleMeta(outputDir, expectedMeta);
      if (platform !== "win32") {
        try {
          fs.chmodSync(binaryPath, 0o755);
        } catch {}
      }
      console.log(`    [copy] bundled -> mock-cdn (${bundledBinaryPath})`);
      process.exit(0);
    }
  }

  const tmpFile = path.join(outputDir, `.glm-dl-${Date.now()}.part`);

  try {
    console.log(`    [download] ${downloadUrl}`);
    await download(downloadUrl, tmpFile);
    fs.rmSync(binaryPath, { force: true });
    fs.renameSync(tmpFile, binaryPath);

    if (platform !== "win32") {
      try {
        fs.chmodSync(binaryPath, 0o755);
      } catch {}
    }
    writeGlmBundleMeta(outputDir, expectedMeta);

    console.log(`==> Done! glm (${platformKey}) -> ${binaryPath}`);
  } catch (err) {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
    console.error(`    [error] ${err.message}`);
    process.exit(1);
  }
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryHref === import.meta.url) {
  await main();
}
