#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveVerificationTarget } from "./verify-remote-ssh-target.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const readArg = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const target = resolveVerificationTarget(readArg("--target"));
const archive = join(packageRoot, "dist-release", `cf-server-${target}.tar.gz`);
const containerName = `cf-proxy-stdio-${process.pid}`;
const image = process.env.CF_PROXY_STDIO_IMAGE ?? "node:24-bookworm-slim";

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    if (options.input) child.stdin.end(options.input);
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      const result = {
        code: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
      if (result.code === 0 || options.allowFailure) resolvePromise(result);
      else
        rejectPromise(
          new Error(`${command} ${args.join(" ")} failed: ${result.stderr.toString("utf8")}`),
        );
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

let exitCode = 0;
try {
  await run("docker", ["version"]);
  await run("docker", ["run", "--detach", "--name", containerName, image, "sleep", "infinity"]);
  await run("docker", ["cp", archive, `${containerName}:/tmp/cf-server.tar.gz`]);
  await run("docker", [
    "exec",
    containerName,
    "sh",
    "-lc",
    [
      "mkdir -p /tmp/cf-bootstrap",
      "tar -xzf /tmp/cf-server.tar.gz -C /tmp/cf-bootstrap --strip-components=1",
      "/tmp/cf-bootstrap/bin/cf update --from-archive /tmp/cf-server.tar.gz --server-root /root/.cf/server --json",
      "CF_SERVER_SKIP_SERVICE_REGISTRATION=1 /root/.cf/server/bin/cf serve --daemon --server-root /root/.cf/server --json",
    ].join(" && "),
  ]);
  const statusResult = await run("docker", [
    "exec",
    containerName,
    "/root/.cf/server/bin/cf",
    "status",
    "--server-root",
    "/root/.cf/server",
    "--json",
  ]);
  const status = JSON.parse(statusResult.stdout.toString("utf8").trim().split("\n").pop());
  assert(status.state === "ready", `Source Server ready, got ${status.state}`);
  const tokenResult = await run("docker", [
    "exec",
    containerName,
    "cat",
    "/root/.cf/server/run/ingress-token",
  ]);
  const token = tokenResult.stdout.toString("utf8").trim();
  assert(token.length >= 32, "ingress token exists");

  const binaryPayload = Buffer.concat([
    Buffer.from([0, 1, 2, 13, 10, 127, 128, 254, 255]),
    randomBytes(64 * 1024),
  ]);
  const binaryRoundTrip = await run("docker", ["exec", "-i", containerName, "sh", "-lc", "cat"], {
    input: binaryPayload,
  });
  assert(binaryRoundTrip.stdout.equals(binaryPayload), "docker exec preserves 64 KiB binary data");
  assert(binaryRoundTrip.stderr.length === 0, "docker exec binary bridge keeps stderr empty");

  const request = Buffer.from(
    `GET /api/server-info HTTP/1.1\r\nHost: source-server\r\nAuthorization: Bearer ${token}\r\nConnection: close\r\n\r\n`,
    "utf8",
  );
  const response = await run(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "/root/.cf/server/bin/cf",
      "server",
      "proxy-stdio",
      "--server-root",
      "/root/.cf/server",
    ],
    { input: request },
  );
  const rawResponse = response.stdout.toString("utf8");
  assert(
    rawResponse.startsWith("HTTP/1.1 200"),
    `proxy response is HTTP 200: ${rawResponse.slice(0, 80)}`,
  );
  assert(rawResponse.includes('"serverId"'), "proxy response contains server-info JSON");
  console.log(
    `[verify-proxy-stdio-docker] PASS target=${target} httpBytes=${response.stdout.length} binaryBytes=${binaryPayload.length}`,
  );
} catch (error) {
  exitCode = 1;
  console.error(
    "[verify-proxy-stdio-docker] FAILED:",
    error instanceof Error ? error.message : error,
  );
} finally {
  await run("docker", ["rm", "-f", containerName], { allowFailure: true }).catch(() => undefined);
}
process.exit(exitCode);
