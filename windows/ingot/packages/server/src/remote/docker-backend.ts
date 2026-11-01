import { spawn, execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { DockerConnectOptions } from "@origin-ai/cf-shared";
import type {
  IRemoteBackend,
  RemoteEnvironment,
  RemoteUploadOptions,
  StdioStream,
} from "@origin-ai/cf-server/remote/backend.js";
import { createCloseEventController } from "@origin-ai/cf-server/remote/closeEvent.js";
import {
  isDockerAvailable,
  listDockerContainers,
  resolveDockerCommand,
  type DockerContainerInfo,
} from "@origin-ai/cf-server/remote/docker-detect.js";
import {
  normalizeRemoteArch,
  normalizeRemotePlatform,
  resolveRemotePlatform,
} from "@origin-ai/cf-server/remote/detectEnv.js";

interface ResolvedDockerInfo {
  containerName: string;
  homeDir: string;
}

const DOCKER_EXEC_MAX_BUFFER = 8 * 1024 * 1024;
const DOCKER_UPLOAD_MAX_STDERR_LENGTH = 2_048;

function quotePosixShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function normalizeDockerOutput(raw: string): string {
  return raw.replace(/\r/g, "");
}

function buildDockerExecArgs(containerName: string, commandArgs: string[]): string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(containerName)) {
    throw new Error("Invalid Docker container reference");
  }
  return ["exec", "-i", containerName, ...commandArgs];
}

export class DockerBackend implements IRemoteBackend {
  private readonly dockerCommand = resolveDockerCommand();
  private readonly options: DockerConnectOptions;
  private availabilityPromise: Promise<void> | null = null;
  private resolvedInfoPromise: Promise<ResolvedDockerInfo> | null = null;

  constructor(options: DockerConnectOptions) {
    this.options = options;
  }

  async detect(): Promise<RemoteEnvironment> {
    await this.ensureAvailable();
    const reportedPlatform = normalizeRemotePlatform(
      normalizeDockerOutput(await this.execSimple("uname -s")),
    );
    const arch = normalizeRemoteArch(normalizeDockerOutput(await this.execSimple("uname -m")));
    const kernelOstype = await this.readKernelOstype();
    const platform = resolveRemotePlatform(reportedPlatform, kernelOstype);

    if (platform !== reportedPlatform) {
      console.warn(
        `[docker] detect: uname reported ${reportedPlatform}, but kernel ostype is ${kernelOstype}; fallback to ${platform}`,
      );
    }

    return {
      platform,
      arch,
    };
  }

  async upload(
    localPath: string,
    remotePath: string,
    options?: RemoteUploadOptions,
  ): Promise<void> {
    await this.ensureAvailable();
    const resolvedInfo = await this.resolveInfo();
    const resolvedRemotePath = this.resolveLinuxPath(remotePath, resolvedInfo.homeDir);
    const parentDir = this.dirname(resolvedRemotePath);

    await this.execSimple(`mkdir -p ${quotePosixShellArg(parentDir)}`);

    await this.uploadViaExec(localPath, resolvedRemotePath, options ?? {});
  }

  private async uploadViaExec(
    localPath: string,
    resolvedRemotePath: string,
    options: RemoteUploadOptions,
  ): Promise<void> {
    const totalBytes = await stat(localPath).then((value) => value.size);
    if (options.signal?.aborted) {
      const error = new Error("Remote upload canceled");
      error.name = "AbortError";
      throw error;
    }
    const stream = await this.exec(`cat > ${quotePosixShellArg(resolvedRemotePath)}`);
    await new Promise<void>((resolve, reject) => {
      const readStream = createReadStream(localPath);
      const stdin = stream.stdin;
      let stderrText = "";
      let uploadedBytes = 0;
      let settled = false;
      const onStderr = (chunk: Buffer | string) => {
        stderrText = `${stderrText}${chunk.toString()}`.slice(-DOCKER_UPLOAD_MAX_STDERR_LENGTH);
      };
      stream.stderr.on("data", onStderr);
      const removeStderrListener = () => {
        stream.stderr.removeListener("data", onStderr);
      };
      const finishError = (error: Error) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener("abort", abort);
        removeStderrListener();
        readStream.destroy();
        const destroyable = stdin as NodeJS.WritableStream & {
          destroy?: (reason?: Error) => void;
        };
        destroyable.destroy?.(error);
        reject(error);
      };
      const abort = () => {
        const error = new Error("Remote upload canceled");
        error.name = "AbortError";
        finishError(error);
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      readStream.on("data", (chunk: Buffer) => {
        uploadedBytes += chunk.length;
        options.onProgress?.({ uploadedBytes, totalBytes });
      });
      readStream.on("error", finishError);
      stdin.on("error", finishError);
      stream.onClose((code) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener("abort", abort);
        removeStderrListener();
        if (code !== 0) {
          const stderrSummary = normalizeDockerOutput(stderrText).trim();
          reject(
            new Error(
              stderrSummary
                ? `Docker upload failed with exit code ${code}: ${stderrSummary}`
                : `Docker upload failed with exit code ${code}`,
            ),
          );
          return;
        }
        options.onProgress?.({ uploadedBytes: totalBytes, totalBytes });
        resolve();
      });
      readStream.pipe(stdin);
    });
  }

  async exec(command: string): Promise<StdioStream> {
    const containerRef = this.options.container.trim();

    return new Promise((resolve, reject) => {
      const child = spawn(
        this.dockerCommand,
        buildDockerExecArgs(containerRef, ["sh", "-lc", command]),
        {
          stdio: "pipe",
          windowsHide: true,
        },
      );

      child.once("error", reject);
      child.once("spawn", () => {
        const stdin = child.stdin;
        const stdout = child.stdout;
        const stderr = child.stderr;
        if (!stdin || !stdout || !stderr) {
          reject(new Error("Docker exec stdio is not available"));
          return;
        }

        const onClose = createCloseEventController();
        let fired = false;
        const fireOnce = (code: number) => {
          if (fired) {
            return;
          }
          fired = true;
          onClose.fire(code);
        };

        child.on("exit", (code) => {
          fireOnce(code ?? 0);
        });
        child.on("close", (code) => {
          fireOnce(code ?? 0);
        });

        resolve({
          stdin,
          stdout,
          stderr,
          onClose: onClose.event,
        });
      });
    });
  }

  async exists(remotePath: string): Promise<boolean> {
    try {
      const resolvedInfo = await this.resolveInfo();
      const resolvedRemotePath = this.resolveLinuxPath(remotePath, resolvedInfo.homeDir);
      await this.execSimple(`test -f ${quotePosixShellArg(resolvedRemotePath)} && printf OK`);
      return true;
    } catch {
      return false;
    }
  }

  async readFile(remotePath: string): Promise<string> {
    if (remotePath === "~" || remotePath.startsWith("~/")) {
      const shellPath =
        remotePath === "~" ? '"$HOME"' : `"$HOME"/${quotePosixShellArg(remotePath.slice(2))}`;
      return normalizeDockerOutput(
        await this.execDirectInContainer(this.options.container.trim(), [
          "sh",
          "-lc",
          `cat ${shellPath}`,
        ]),
      );
    }
    const resolvedInfo = await this.resolveInfo();
    const resolvedRemotePath = this.resolveLinuxPath(remotePath, resolvedInfo.homeDir);
    return normalizeDockerOutput(
      await this.execSimple(`cat ${quotePosixShellArg(resolvedRemotePath)}`),
    );
  }

  dispose(): void {
  }

  private async ensureAvailable(): Promise<void> {
    if (!this.availabilityPromise) {
      this.availabilityPromise = isDockerAvailable()
        .then((available) => {
          if (!available) throw new Error("当前系统未检测到可用的 Docker 环境");
        })
        .catch((error) => {
          this.availabilityPromise = null;
          throw error;
        });
    }
    await this.availabilityPromise;
  }

  private async resolveInfo(): Promise<ResolvedDockerInfo> {
    if (this.resolvedInfoPromise) {
      return this.resolvedInfoPromise;
    }

    this.resolvedInfoPromise = (async () => {
      const container = await this.resolveContainer();
      const homeDir = normalizeDockerOutput(
        await this.execDirectInContainer(container.name, ["sh", "-lc", "printf %s ~"]),
      ).trim();

      return {
        containerName: container.name,
        homeDir,
      };
    })();

    return this.resolvedInfoPromise;
  }

  private async resolveContainer(): Promise<DockerContainerInfo> {
    const containers = await listDockerContainers({ all: true });
    const matched = containers.find(
      (container) =>
        container.name === this.options.container ||
        container.id === this.options.container ||
        container.id.startsWith(this.options.container),
    );

    if (!matched) {
      throw new Error(`未找到名为 ${this.options.container} 的 Docker 容器`);
    }

    if (matched.state.toLowerCase() !== "running") {
      throw new Error(
        `Docker 容器 ${matched.name} Current未Run（state=${matched.state || "unknown"}）`,
      );
    }

    return matched;
  }

  private resolveLinuxPath(remotePath: string, homeDir: string): string {
    if (remotePath === "~") {
      return homeDir;
    }

    if (remotePath.startsWith("~/")) {
      return `${homeDir.replace(/\/$/, "")}/${remotePath.slice(2)}`;
    }

    return remotePath;
  }

  private dirname(remotePath: string): string {
    const normalized = remotePath.replace(/\/+/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash <= 0) {
      return "/";
    }

    return normalized.slice(0, lastSlash);
  }

  private async execSimple(command: string): Promise<string> {
    return this.execDirect(["sh", "-lc", command]);
  }

  private async readKernelOstype(): Promise<string> {
    try {
      return normalizeDockerOutput(
        await this.execSimple(
          "if [ -r /proc/sys/kernel/ostype ]; then cat /proc/sys/kernel/ostype; fi",
        ),
      ).trim();
    } catch {
      return "";
    }
  }

  private async execDirect(commandArgs: string[]): Promise<string> {
    const container = await this.resolveContainer();
    return await this.execDirectInContainer(container.name, commandArgs);
  }

  private async execDirectInContainer(
    containerName: string,
    commandArgs: string[],
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.dockerCommand,
        buildDockerExecArgs(containerName, commandArgs),
        {
          encoding: "utf8",
          maxBuffer: DOCKER_EXEC_MAX_BUFFER,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(normalizeDockerOutput(stderr).trim() || error.message));
            return;
          }

          resolve(normalizeDockerOutput(stdout));
        },
      );
    });
  }
}
