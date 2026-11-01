import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import {
  assertPrebuiltArchiveSha256,
  extractPrebuiltArchive,
  findPrebuiltBinary,
  verifyPrebuiltArchiveSha256,
} from "./prebuilt-binary-extract.mjs";

export { extractPrebuiltArchive, findPrebuiltBinary, verifyPrebuiltArchiveSha256 };

const DOWNLOAD_TIMEOUT_MS = 60_000;
const PROXY_DOWNLOAD_HOSTS = new Set(["github.com", "githubusercontent.com"]);

export function shouldUsePrebuiltDownloadProxy(rawUrl) {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  return PROXY_DOWNLOAD_HOSTS.has(hostname) || hostname.endsWith(".githubusercontent.com");
}

export async function downloadPrebuiltArchive(url, destinationPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const client = url.startsWith("https:") ? https : http;
    const file = createWriteStream(destinationPath);
    let handled = false;

    const cleanupAndReject = (error) => {
      if (handled) return;
      handled = true;
      file.close(() => {
        rmSync(destinationPath, { force: true });
        rejectPromise(error);
      });
    };

    const requestOptions = shouldUsePrebuiltDownloadProxy(url)
      ? { agent: new client.Agent({ proxyEnv: process.env }) }
      : { agent: false };
    const request = client
      .get(url, requestOptions, (response) => {
        response.once("aborted", () => {
          cleanupAndReject(new Error(`Download aborted before completion (${url})`));
        });
        response.once("error", cleanupAndReject);

        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          handled = true;
          response.resume();
          file.close(() => {
            rmSync(destinationPath, { force: true });
            downloadPrebuiltArchive(response.headers.location, destinationPath).then(
              resolvePromise,
              rejectPromise,
            );
          });
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          cleanupAndReject(new Error(`Download failed: HTTP ${response.statusCode} (${url})`));
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          if (handled) return;
          handled = true;
          file.close((error) => {
            if (error) {
              rmSync(destinationPath, { force: true });
              rejectPromise(error);
              return;
            }
            resolvePromise();
          });
        });
      })
      .on("error", cleanupAndReject);

    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms (${url})`));
    });

    file.on("error", cleanupAndReject);
  });
}

export async function downloadAndExtractPrebuiltBinary({
  archiveExt,
  archiveSha256,
  binaryName,
  binaryPath,
  cwd,
  downloadUrl,
  targetPlatform,
  validateBinary,
}) {
  const normalizedArchiveSha256 = assertPrebuiltArchiveSha256(archiveSha256);
  mkdirSync(dirname(binaryPath), { recursive: true });
  mkdirSync(tmpdir(), { recursive: true });
  const tempDir = mkdtempSync(join(tmpdir(), "cf-prebuilt-binary-"));
  const archivePath = join(tempDir, `archive.${archiveExt}`);
  const extractDir = join(tempDir, "extract");

  try {
    await downloadPrebuiltArchive(downloadUrl, archivePath);
    verifyPrebuiltArchiveSha256(archivePath, normalizedArchiveSha256);
    extractPrebuiltArchive({ archivePath, archiveExt, extractDir, cwd });
    const extractedBinaryPath = findPrebuiltBinary(extractDir, binaryName);
    if (!extractedBinaryPath) {
      throw new Error(`Failed to locate ${binaryName} in extracted archive`);
    }

    await validateBinary?.(extractedBinaryPath);
    copyFileSync(extractedBinaryPath, binaryPath);
    if (targetPlatform !== "win32") {
      chmodSync(binaryPath, 0o755);
    }
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}
