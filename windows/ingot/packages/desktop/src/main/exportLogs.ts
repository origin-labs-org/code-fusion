
import { constants, createReadStream, createWriteStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";

import {
  createFeedbackDiagnosticArchive,
  getAppConfigDir,
  getExportLogDir as getDefaultExportLogDir,
  getExportLogStageDir as getDefaultExportLogStageDir,
  getFeedbackLogArchiveDir as getDefaultFeedbackLogArchiveDir,
} from "@origin-ai/cf-services/node";
import { createAboutSnapshot, formatAboutDetail, readBuildMetadata } from "./about.js";
import { logger } from "./logger.js";

function getCfDataDir() {
  return getAppConfigDir();
}

function getCfCliDir() {
  return join(homedir(), ".cf", "cli");
}

function getCfCliLogDir() {
  return join(getCfCliDir(), "log");
}

function getCuaHelperRunDir() {
  return join(homedir(), ".cf", "computer-use", "run");
}

function isCuaHelperDiagnosticFileName(fileName: string): boolean {
  return fileName.endsWith(".exit.log");
}

interface LogArchiveFileEntry {
  absolutePath: string;
  archivePath: string;
}

interface LogArchiveArtifacts {
  files: LogArchiveFileEntry[];
  aboutContent: string;
}

interface CreateLogArchiveArtifactsOptions {
  now?: () => Date;
  lookbackDays?: number;
}

interface LogArchiveSkippedFileEntry {
  absolutePath: string;
  archivePath: string;
  error: string;
}

interface ExportLogsDependencies {
  now?: () => Date;
  getCfDataDir?: () => string;
  getExportLogStageDir?: () => string;
  getExportLogDir?: () => string;
  createLogArchiveArtifacts?: (
    sourceDir: string,
    options?: CreateLogArchiveArtifactsOptions,
  ) => Promise<LogArchiveArtifacts>;
  writeLogArchiveZip?: (
    outputPath: string,
    artifacts: LogArchiveArtifacts,
    options?: WriteLogArchiveZipOptions,
  ) => Promise<void>;
  writeLogArchiveDirectory?: (outputPath: string, artifacts: LogArchiveArtifacts) => Promise<void>;
  showItemInFolder?: (path: string) => Promise<void> | void;
}

interface WriteLogArchiveZipOptions {
  stageRootDir?: string;
}

interface CreateFeedbackLogArchiveFromExportLogsOptions {
  now?: () => Date;
  outputRootDir?: string;
  stageRootDir?: string;
  onProgress?: (event: { processedBytes: number; totalBytes: number }) => void;
}

function formatTimestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function normalizeArchivePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function escapeRegExp(path: string): string {
  return path.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globPatternToRegExp(pattern: string): RegExp {
  const normalizedPattern = normalizeArchivePath(pattern);
  return new RegExp(`^${normalizedPattern.split("*").map(escapeRegExp).join(".*")}$`);
}

/**
 * Glob patterns to exclude from the exported log archive.
 * Each pattern is relative to the source directory being archived.
 */
const ZIP_EXCLUDE_PATTERNS: string[] = [];

const ZIP_EXCLUDE_REGEXES = ZIP_EXCLUDE_PATTERNS.map(globPatternToRegExp);
const RETIRED_ACP_RUNTIME_ARCHIVE_PATHS = [
  "acp-auth",
  "acp-config",
  "acp-stream-diagnostics",
  "acp-traffic-proxy",
] as const;
const HIGH_VOLUME_RUNTIME_ARCHIVE_PATHS = ["dev"] as const;
const DOCSHOT_ARCHIVE_PATH_PREFIXES = ["docshot-backup-"] as const;
const DOCSHOT_ARCHIVE_PATHS = ["docshot-assets"] as const;
const NON_LOG_STATE_ARCHIVE_PATHS = [
  "agent-config",
  "certs",
  "repo-snapshots",
  "repo-wiki",
  "sessions",
  "session-bindings",
  "checkpoints",
] as const;
const SENSITIVE_CREDENTIAL_ARCHIVE_FILE_NAMES = new Set(["credentials.json", ".credentials.json"]);
const EXCLUDED_ARCHIVE_DIRECTORY_NAMES = new Set(["debug"]);
const DEFAULT_LOG_EXPORT_LOOKBACK_DAYS = 3;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const REDACTED_PLACEHOLDER = "***REDACTED***";
const SENSITIVE_KEY_SUBSTRING_PATTERN = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "credential",
  "api(?:_|-)?key",
  "access(?:_|-)?key",
  "private(?:_|-)?key",
  "auth",
  "cookie",
  "dsn",
  "conn(?:ection)?(?:_|-)?str(?:ing)?",
  "database(?:_|-)?url",
  "db(?:_|-)?url",
].join("|");
const SENSITIVE_KEY_NAME_REGEX = new RegExp(`(?:${SENSITIVE_KEY_SUBSTRING_PATTERN})`, "i");
const NON_SENSITIVE_KEY_NAME_ALLOWLIST_REGEX =
  /^(?:public(?:_|-)?key|keywords?|tokenizer|token(?:_|-)?count|(?:prompt|completion|total|input|output|cached|reasoning|max|budget|accepted(?:_|-)?prediction|rejected(?:_|-)?prediction|tool(?:_|-)?use(?:_|-)?prompt)(?:_|-)?tokens|author(?:s|ity|ed)?)$/i;

function isSensitiveKeyName(keyName: string): boolean {
  if (NON_SENSITIVE_KEY_NAME_ALLOWLIST_REGEX.test(keyName)) {
    return false;
  }
  return SENSITIVE_KEY_NAME_REGEX.test(keyName);
}

const JSON_STYLE_SENSITIVE_VALUE_REGEX =
  /(["'])([A-Za-z0-9_.-]+)\1(\s*:\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,\r\n}\]]+)/g;
const ASSIGNMENT_STYLE_SENSITIVE_VALUE_REGEX =
  /((?:^|\n)[ \t]*)([A-Za-z0-9_.-]+)([ \t]*=[ \t]*)([^\r\n#]+)/g;
const HEADER_STYLE_SENSITIVE_VALUE_REGEX =
  /((?:^|\n)[ \t]*)([A-Za-z0-9-]+)([ \t]*:[ \t]*)([^\r\n]+)/g;
const BEARER_TOKEN_REGEX = /(Bearer\s+)([^\s"']+)/g;
const QUERY_TOKEN_REGEX =
  /([?&](?:key|api(?:_|-)?key|access(?:_|-)?token|refresh(?:_|-)?token|token|password|passwd|pwd|secret|client(?:_|-)?secret|auth(?:_|-)?token|session(?:_|-)?token)=)([^&#\s]+)/gi;
const CONNECTION_STRING_CREDENTIALS_REGEX =
  /\b([a-z][a-z0-9+.-]*:\/\/)([^:/\s]*):([^/\s]+)@(?=[^@/\s])/gi;
const TEXT_DETECTION_SAMPLE_BYTES = 64 * 1024;
const EMPTY_BOM = Buffer.alloc(0);

type SupportedTextEncoding = "utf-8" | "utf-16le" | "utf-16be";

interface TextFileEncodingInfo {
  encoding: SupportedTextEncoding;
  bomLength: number;
  bomBytes: Buffer;
}

interface TextDecodingScore {
  preferredCharRatio: number;
  invalidCharRatio: number;
}

function redactValue(rawValue: string): string {
  const leadingSpaces = rawValue.match(/^\s*/)?.[0] ?? "";
  const trailingSpaces = rawValue.match(/\s*$/)?.[0] ?? "";
  const core = rawValue.trim();
  const quote =
    core.startsWith('"') && core.endsWith('"')
      ? '"'
      : core.startsWith("'") && core.endsWith("'")
        ? "'"
        : "";
  const redacted = quote ? `${quote}${REDACTED_PLACEHOLDER}${quote}` : REDACTED_PLACEHOLDER;
  return `${leadingSpaces}${redacted}${trailingSpaces}`;
}

function redactHeaderValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (/^bearer\s+/i.test(trimmed)) {
    return trimmed.replace(/^bearer\s+.+$/i, `Bearer ${REDACTED_PLACEHOLDER}`);
  }
  return REDACTED_PLACEHOLDER;
}

function redactConnectionStringCredentials(rawContent: string): string {
  // postgres://admin:secret@host → postgres://***REDACTED***:***REDACTED***@host
  return rawContent.replace(
    CONNECTION_STRING_CREDENTIALS_REGEX,
    (_match, scheme: string) => `${scheme}${REDACTED_PLACEHOLDER}:${REDACTED_PLACEHOLDER}@`,
  );
}

async function collectLogArchiveFilesByName(
  absoluteDir: string,
  relativeDir: string,
  isCollectableFileName: (fileName: string) => boolean,
  files: LogArchiveFileEntry[],
): Promise<void> {
  const dirents = await readdir(absoluteDir, { withFileTypes: true }).catch(() => null);
  if (!dirents) {
    return;
  }
  dirents.sort((left, right) => left.name.localeCompare(right.name));
  for (const dirent of dirents) {
    if (!dirent.isFile() || !isCollectableFileName(dirent.name)) {
      continue;
    }
    await collectLogArchiveFile(
      join(absoluteDir, dirent.name),
      posix.join(relativeDir, dirent.name),
      files,
    );
  }
}

async function collectLogArchiveFile(
  absolutePath: string,
  archivePath: string,
  files: LogArchiveFileEntry[],
): Promise<void> {
  if (isExcludedRelativePath(archivePath)) {
    return;
  }
  const fileStats = await stat(absolutePath).catch(() => null);
  if (!fileStats?.isFile()) {
    return;
  }
  files.push({ absolutePath, archivePath });
}

export async function collectLogArchiveFiles(sourceDir: string): Promise<LogArchiveFileEntry[]> {
  const files: LogArchiveFileEntry[] = [];
  const visitedDirs = new Set<string>();
  await collectLogArchiveFilesFromDirectory(sourceDir, "", visitedDirs, files);
  files.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
  return files;
}

export async function createLogArchiveArtifacts(
  sourceDir: string,
  options: CreateLogArchiveArtifactsOptions = {},
): Promise<LogArchiveArtifacts> {
  const files: LogArchiveFileEntry[] = [];
  const visitedDirs = new Set<string>();

  await collectLogArchiveFilesFromDirectory(sourceDir, "", visitedDirs, files);

  const cfCliLogDir = getCfCliLogDir();
  await collectLogArchiveFilesFromDirectory(
    cfCliLogDir,
    posix.join(".cf", "cli", "log"),
    visitedDirs,
    files,
  );

  const cfCliDir = getCfCliDir();
  await collectLogArchiveFile(
    join(cfCliDir, "config.json"),
    posix.join(".cf", "cli", "config.json"),
    files,
  );
  await collectLogArchiveFilesFromDirectory(
    join(cfCliDir, "rollout"),
    posix.join(".cf", "cli", "rollout"),
    visitedDirs,
    files,
  );

  await collectLogArchiveFilesByName(
    getCuaHelperRunDir(),
    posix.join(".cf", "computer-use", "run"),
    isCuaHelperDiagnosticFileName,
    files,
  );

  const recentFiles = await filterRecentLogArchiveFiles(files, options);
  recentFiles.sort((left, right) => left.archivePath.localeCompare(right.archivePath));

  return {
    files: recentFiles,
    aboutContent: createAboutContent(),
  };
}

async function copyLogArchiveFilesToDirectory(
  outputPath: string,
  files: LogArchiveFileEntry[],
): Promise<LogArchiveSkippedFileEntry[]> {
  const skippedFiles: LogArchiveSkippedFileEntry[] = [];

  for (const file of files) {
    const destinationPath = join(outputPath, ...file.archivePath.split("/"));
    await mkdir(dirname(destinationPath), { recursive: true });

    const sourceStats = await stat(file.absolutePath).catch((error: unknown) => {
      skippedFiles.push({
        absolutePath: file.absolutePath,
        archivePath: file.archivePath,
        error: formatErrorMessage(error),
      });
      return null;
    });
    if (!sourceStats?.isFile()) {
      continue;
    }

    const sourceReadable = await access(file.absolutePath, constants.R_OK)
      .then(() => true)
      .catch((error: unknown) => {
        skippedFiles.push({
          absolutePath: file.absolutePath,
          archivePath: file.archivePath,
          error: formatErrorMessage(error),
        });
        return false;
      });
    if (!sourceReadable) {
      continue;
    }

    try {
      const sourceSample = await readFileSample(file.absolutePath);
      const textEncodingInfo = detectTextFileEncoding(sourceSample);
      if (!textEncodingInfo) {
        await copyFile(file.absolutePath, destinationPath);
      } else {
        await sanitizeTextLogFileToDestination(
          file.absolutePath,
          destinationPath,
          textEncodingInfo,
        );
      }
    } catch (error) {
      const sourceStatsAfterFailure = await stat(file.absolutePath).catch(() => null);
      const sourceReadableAfterFailure = sourceStatsAfterFailure?.isFile()
        ? await access(file.absolutePath, constants.R_OK)
            .then(() => true)
            .catch(() => false)
        : false;
      if (!sourceReadableAfterFailure) {
        skippedFiles.push({
          absolutePath: file.absolutePath,
          archivePath: file.archivePath,
          error: formatErrorMessage(error),
        });
        continue;
      }
      throw error;
    }
  }

  return skippedFiles;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExcludedRelativePath(archivePath: string): boolean {
  const normalized = normalizeArchivePath(archivePath).replace(/^\/+/, "");
  if (!normalized) return false;
  const segments = normalized.split("/").filter(Boolean);
  const fileName = segments[segments.length - 1] ?? "";
  if (SENSITIVE_CREDENTIAL_ARCHIVE_FILE_NAMES.has(fileName)) return true;
  if (segments.some((segment) => EXCLUDED_ARCHIVE_DIRECTORY_NAMES.has(segment))) return true;
  const first = segments[0] ?? "";
  if (first === "Library" && segments[1] === "Caches") return true;
  const excludedRoots = [
    ...(NON_LOG_STATE_ARCHIVE_PATHS as readonly string[]),
    ...(RETIRED_ACP_RUNTIME_ARCHIVE_PATHS as readonly string[]),
    ...(HIGH_VOLUME_RUNTIME_ARCHIVE_PATHS as readonly string[]),
    ...(DOCSHOT_ARCHIVE_PATHS as readonly string[]),
  ];
  if (excludedRoots.includes(first)) return true;
  if (DOCSHOT_ARCHIVE_PATH_PREFIXES.some((prefix) => first.startsWith(prefix))) return true;
  return ZIP_EXCLUDE_REGEXES.some((regex) => regex.test(normalized));
}

async function collectLogArchiveFilesFromDirectory(
  absoluteDir: string,
  relativeDir: string,
  visitedDirs: Set<string>,
  files: LogArchiveFileEntry[],
): Promise<void> {
  const realDir = await realpath(absoluteDir).catch(() => null);
  if (!realDir || visitedDirs.has(realDir)) return;
  visitedDirs.add(realDir);
  const dirents = await readdir(absoluteDir, { withFileTypes: true }).catch((error: unknown) => {
    logger.warn("[export-logs] Unreadable log directory detected, automatically skipped during export", {
      absolutePath: absoluteDir,
      archivePath: relativeDir,
      error: formatErrorMessage(error),
    });
    return null;
  });
  if (!dirents) return;
  dirents.sort((left, right) => left.name.localeCompare(right.name));
  for (const dirent of dirents) {
    const archivePath = relativeDir
      ? posix.join(relativeDir, dirent.name)
      : dirent.name;
    if (isExcludedRelativePath(archivePath)) continue;
    const absolutePath = join(absoluteDir, dirent.name);
    if (dirent.isDirectory()) {
      await collectLogArchiveFilesFromDirectory(absolutePath, archivePath, visitedDirs, files);
      continue;
    }
    if (dirent.isFile()) {
      files.push({ absolutePath, archivePath });
    }
  }
}

function isRecentLookbackPath(archivePath: string): boolean {
  return (
    archivePath === "logs" ||
    archivePath.startsWith("logs/") ||
    archivePath === ".cf/cli/log" ||
    archivePath.startsWith(".cf/cli/log/")
  );
}

async function filterRecentLogArchiveFiles(
  files: readonly LogArchiveFileEntry[],
  options: CreateLogArchiveArtifactsOptions,
): Promise<LogArchiveFileEntry[]> {
  const lookbackDays = Math.max(1, options.lookbackDays ?? DEFAULT_LOG_EXPORT_LOOKBACK_DAYS);
  const now = (options.now ?? (() => new Date()))();
  const cutoff = now.getTime() - lookbackDays * MILLISECONDS_PER_DAY;
  const recent: LogArchiveFileEntry[] = [];
  for (const file of files) {
    if (!isRecentLookbackPath(file.archivePath)) {
      recent.push(file);
      continue;
    }
    const fileStats = await stat(file.absolutePath).catch(() => null);
    if (!fileStats?.isFile()) continue;
    if (fileStats.mtimeMs >= cutoff) recent.push(file);
  }
  return recent;
}

function createAboutContent(): string {
  return formatAboutDetail(
    createAboutSnapshot({
      buildMetadata: readBuildMetadata(),
    }),
  );
}

async function readFileSample(filePath: string): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(TEXT_DETECTION_SAMPLE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function tryDecodeText(encoding: SupportedTextEncoding, sample: Buffer): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(sample);
  } catch {
    return null;
  }
}

function isPlausibleText(decoded: string): boolean {
  if (decoded.length === 0) return true;
  let suspicious = 0;
  for (const character of decoded) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0xfffd) {
      suspicious += 1;
      continue;
    }
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      suspicious += 1;
    }
  }
  return suspicious / decoded.length < 0.02;
}

function scoreDecodedText(decoded: string): number {
  let score = 0;
  for (const character of decoded) {
    const code = character.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || code === 0x09 || code === 0x0a || code === 0x0d) {
      score += 1;
      continue;
    }
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x2e80 && code <= 0x2eff)
    ) {
      score += 2;
    }
  }
  return score;
}

function detectUtf16WithoutBom(sample: Buffer): SupportedTextEncoding | null {
  const pairs = Math.floor(sample.length / 2);
  if (pairs < 2) return null;
  let zerosAtEven = 0;
  let zerosAtOdd = 0;
  for (let index = 0; index + 1 < sample.length; index += 2) {
    if (sample[index] === 0) zerosAtEven += 1;
    if (sample[index + 1] === 0) zerosAtOdd += 1;
  }
  if (zerosAtOdd >= pairs * 0.3 && zerosAtEven < pairs * 0.05) return "utf-16le";
  if (zerosAtEven >= pairs * 0.3 && zerosAtOdd < pairs * 0.05) return "utf-16be";
  if (zerosAtEven === 0 && zerosAtOdd === 0) {
    const le = tryDecodeText("utf-16le", sample);
    const be = tryDecodeText("utf-16be", sample);
    const lePlausible = le !== null && isPlausibleText(le);
    const bePlausible = be !== null && isPlausibleText(be);
    if (lePlausible && bePlausible) {
      return scoreDecodedText(le) >= scoreDecodedText(be) ? "utf-16le" : "utf-16be";
    }
    if (lePlausible) return "utf-16le";
    if (bePlausible) return "utf-16be";
    return null;
  }
  // Mixed CJK + ASCII payloads do not hit the 30% zero-byte threshold above, so try the
  // likely endianness directly and fall back to the other one when the strict decode fails.
  const preferred: SupportedTextEncoding = zerosAtOdd >= zerosAtEven ? "utf-16le" : "utf-16be";
  const preferredText = tryDecodeText(preferred, sample);
  if (preferredText !== null && isPlausibleText(preferredText)) return preferred;
  const fallback: SupportedTextEncoding = preferred === "utf-16le" ? "utf-16be" : "utf-16le";
  const fallbackText = tryDecodeText(fallback, sample);
  if (fallbackText !== null && isPlausibleText(fallbackText)) return fallback;
  return null;
}

function detectTextFileEncoding(sample: Buffer): TextFileEncodingInfo | null {
  if (sample.length === 0) {
    return { encoding: "utf-8", bomLength: 0, bomBytes: EMPTY_BOM };
  }
  if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
    return { encoding: "utf-8", bomLength: 3, bomBytes: sample.subarray(0, 3) };
  }
  if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) {
    return { encoding: "utf-16le", bomLength: 2, bomBytes: sample.subarray(0, 2) };
  }
  if (sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff) {
    return { encoding: "utf-16be", bomLength: 2, bomBytes: sample.subarray(0, 2) };
  }
  if (!sample.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(sample);
      return { encoding: "utf-8", bomLength: 0, bomBytes: EMPTY_BOM };
    } catch {
      // Fall through to UTF-16 detection for BOM-less CJK payloads.
    }
  }
  const utf16 = detectUtf16WithoutBom(sample);
  if (utf16) {
    return { encoding: utf16, bomLength: 0, bomBytes: EMPTY_BOM };
  }
  return null;
}

function encodeTextWithEncoding(text: string, encodingInfo: TextFileEncodingInfo): Buffer {
  if (encodingInfo.encoding === "utf-8") {
    const body = Buffer.from(text, "utf8");
    return encodingInfo.bomLength > 0
      ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body])
      : body;
  }
  const littleEndian = Buffer.from(text, "utf16le");
  if (encodingInfo.encoding === "utf-16le") {
    return encodingInfo.bomLength > 0
      ? Buffer.concat([Buffer.from([0xff, 0xfe]), littleEndian])
      : littleEndian;
  }
  const bigEndian = Buffer.from(littleEndian);
  for (let index = 0; index + 1 < bigEndian.length; index += 2) {
    const low = bigEndian[index]!;
    bigEndian[index] = bigEndian[index + 1]!;
    bigEndian[index + 1] = low;
  }
  return encodingInfo.bomLength > 0
    ? Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian])
    : bigEndian;
}

function redactSensitiveJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveJsonValue);
  if (typeof value !== "object" || value === null) return value;
  const source = value as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    redacted[key] = isSensitiveKeyName(key)
      ? REDACTED_PLACEHOLDER
      : redactSensitiveJsonValue(entry);
  }
  return redacted;
}

function redactLooseText(raw: string): string {
  let output = raw;
  output = output.replace(
    JSON_STYLE_SENSITIVE_VALUE_REGEX,
    (match, quote: string, key: string, separator: string, value: string) => {
      if (!isSensitiveKeyName(key)) return match;
      return `${quote}${key}${quote}${separator}${redactValue(value)}`;
    },
  );
  output = output.replace(
    ASSIGNMENT_STYLE_SENSITIVE_VALUE_REGEX,
    (match, prefix: string, key: string, separator: string, value: string) => {
      if (!isSensitiveKeyName(key)) return match;
      return `${prefix}${key}${separator}${redactValue(value)}`;
    },
  );
  output = output.replace(
    HEADER_STYLE_SENSITIVE_VALUE_REGEX,
    (match, prefix: string, name: string, separator: string, value: string) => {
      if (!isSensitiveKeyName(name)) return match;
      return `${prefix}${name}${separator}${redactHeaderValue(value)}`;
    },
  );
  output = output.replace(BEARER_TOKEN_REGEX, (_match, prefix: string) => {
    return `${prefix}${REDACTED_PLACEHOLDER}`;
  });
  output = output.replace(QUERY_TOKEN_REGEX, (_match, prefix: string) => {
    return `${prefix}${REDACTED_PLACEHOLDER}`;
  });
  output = redactConnectionStringCredentials(output);
  return output;
}

function redactTextContent(raw: string): string {
  const trimmed = raw.trim();
  const looksLikeJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (looksLikeJson) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return JSON.stringify(redactSensitiveJsonValue(parsed));
    } catch {
      // Not valid JSON at this granularity; fall back to line-oriented redaction.
    }
  }
  return redactLooseText(raw);
}

async function sanitizeTextLogFileToDestination(
  sourcePath: string,
  destinationPath: string,
  encodingInfo: TextFileEncodingInfo,
): Promise<void> {
  const decoder = new TextDecoder(encodingInfo.encoding);
  await pipeline(
    createReadStream(sourcePath),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        try {
          const text = decoder.decode(chunk, { stream: true });
          callback(null, encodeTextWithEncoding(redactTextContent(text), encodingInfo));
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
      flush(callback) {
        try {
          callback(
            null,
            encodeTextWithEncoding(redactTextContent(decoder.decode()), encodingInfo),
          );
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    }),
    createWriteStream(destinationPath),
  );
}

function logSkippedLogArchiveFiles(skippedFiles: LogArchiveSkippedFileEntry[]): void {
  if (skippedFiles.length === 0) {
    return;
  }

  logger.warn("[export-logs] Unreadable log file detected, automatically skipped during export", {
    skippedCount: skippedFiles.length,
    skippedFiles: skippedFiles.slice(0, 10),
  });
}

export async function writeLogArchiveZip(
  outputPath: string,
  artifacts: LogArchiveArtifacts,
  options: WriteLogArchiveZipOptions = {},
): Promise<void> {
  const stageRootDir = options.stageRootDir ?? getDefaultExportLogStageDir();
  await mkdir(stageRootDir, { recursive: true });
  const stagingDir = await mkdtemp(join(stageRootDir, "stage-"));
  try {
    await writeLogArchiveDirectory(stagingDir, artifacts);

    const zipFile = new ZipFile();
    const stageFiles = await collectLogArchiveFiles(stagingDir);
    const outputStream = createWriteStream(outputPath);
    zipFile.once("error", (error) => {
      outputStream.destroy(error instanceof Error ? error : new Error(String(error)));
    });

    for (const file of stageFiles) {
      zipFile.addFile(file.absolutePath, file.archivePath);
    }

    const writePromise = pipeline(zipFile.outputStream, outputStream);
    zipFile.end();
    await writePromise;
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function writeLogArchiveDirectory(
  outputPath: string,
  artifacts: LogArchiveArtifacts,
): Promise<void> {
  await mkdir(outputPath, { recursive: true });
  const skippedFiles = await copyLogArchiveFilesToDirectory(outputPath, artifacts.files);
  logSkippedLogArchiveFiles(skippedFiles);

  await writeFile(join(outputPath, "about.txt"), artifacts.aboutContent, "utf-8");
}

export async function createFeedbackLogArchiveFromExportLogs(
  sourceDir: string,
  options: CreateFeedbackLogArchiveFromExportLogsOptions = {},
): Promise<{ path: string; size: number }> {
  return createFeedbackDiagnosticArchive({
    sources: [
      { directory: join(sourceDir, "logs"), archivePrefix: "logs" },
      { directory: getCfCliLogDir(), archivePrefix: ".cf/cli/log" },
      {
        directory: getCfCliDir(),
        archivePrefix: ".cf/cli",
        includeFileNames: ["config.json"],
        onlyCurrentDay: false,
        contentPolicy: "cli-config",
      },
      {
        directory: join(getCfCliDir(), "rollout"),
        archivePrefix: ".cf/cli/rollout",
      },
      {
        directory: getCuaHelperRunDir(),
        archivePrefix: ".cf/computer-use/run",
        exitLogsOnly: true,
      },
    ],
    outputRootDir: options.outputRootDir ?? getDefaultFeedbackLogArchiveDir(),
    now: options.now,
    onProgress: options.onProgress,
  });
}

export async function exportLogs(
  dependencies: ExportLogsDependencies = {},
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const now = dependencies.now ?? (() => new Date());
    const getSourceDir = dependencies.getCfDataDir ?? getCfDataDir;
    const buildArtifacts = dependencies.createLogArchiveArtifacts ?? createLogArchiveArtifacts;
    const writeZip = dependencies.writeLogArchiveZip ?? writeLogArchiveZip;
    const writeDirectory = dependencies.writeLogArchiveDirectory ?? writeLogArchiveDirectory;
    const showItemInFolder =
      dependencies.showItemInFolder ??
      (async (path: string) => {
        const { shell } = await import("electron");
        shell.showItemInFolder(path);
      });
    const getStageRootDir = dependencies.getExportLogStageDir ?? getDefaultExportLogStageDir;
    const getOutputRootDir = dependencies.getExportLogDir ?? getDefaultExportLogDir;

    const sourceDir = getSourceDir();
    const timestamp = formatTimestamp(now());
    const exportBaseName = `cf-logs-${timestamp}`;
    const outputRootDir = getOutputRootDir();
    await mkdir(outputRootDir, { recursive: true });
    const outputDir = await mkdtemp(join(outputRootDir, `${exportBaseName}-`));
    const zipPath = join(outputDir, `${exportBaseName}.zip`);
    const directoryPath = join(outputDir, exportBaseName);

    logger.info("[export-logs] Starting log packaging", {
      source: sourceDir,
      zipDest: zipPath,
      directoryDest: directoryPath,
    });
    const artifacts = await buildArtifacts(sourceDir, { now });

    try {
      await writeZip(zipPath, artifacts, { stageRootDir: getStageRootDir() });
      await showItemInFolder(zipPath);

      logger.info("[export-logs] Log export completed", {
        path: zipPath,
        format: "zip",
      });
      return { success: true, path: zipPath };
    } catch (zipError) {
      const zipErrorMessage = zipError instanceof Error ? zipError.message : String(zipError);

      logger.warn("[export-logs] ZIP export failed, falling back to folder export", {
        error: zipErrorMessage,
        zipPath,
        fallbackPath: directoryPath,
      });
      await rm(zipPath, { force: true }).catch(() => {});

      try {
        await writeDirectory(directoryPath, artifacts);
      } catch (directoryError) {
        const directoryErrorMessage =
          directoryError instanceof Error ? directoryError.message : String(directoryError);
        throw new Error(`zip 导出Failed：${zipErrorMessage}；Table of Contents导出Failed：${directoryErrorMessage}`);
      }

      await showItemInFolder(directoryPath);
      logger.info("[export-logs] Log export completed", {
        path: directoryPath,
        format: "directory",
      });
      return { success: true, path: directoryPath };
    }
  } catch (err) {
    const message = formatErrorMessage(err);
    logger.error("[export-logs] Log export failed", { error: message });
    return { success: false, error: message };
  }
}
