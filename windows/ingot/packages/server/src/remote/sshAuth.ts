import type { ConnectConfig } from "ssh2";
import type { PublicCfErrorCode } from "@origin-ai/cf-shared";

export const SSH_READY_TIMEOUT_MS = 60_000;
export const SSH_KEEPALIVE_INTERVAL_MS = 15_000;
export const SSH_KEEPALIVE_COUNT_MAX = 3;

interface SSHConnectConfigInput {
  host: string;
  port?: number;
  username: string;
  privateKey?: string | Buffer;
  passphrase?: string;
  password?: string;
  agent?: string;
}

function isMissingPrivateKeyPassphraseMessage(message: string): boolean {
  return /encrypted .*private .*key detected, but no passphrase given/i.test(message);
}

function isInvalidPrivateKeyPassphraseMessage(message: string): boolean {
  return /(bad passphrase|key integrity check failed|unable to authenticate data)/i.test(message);
}

export function buildSSHConnectConfig(input: SSHConnectConfigInput): ConnectConfig {
  const hasPassword = typeof input.password === "string" && input.password.length > 0;

  const resolvedAgent = input.agent ?? (hasPassword ? undefined : process.env["SSH_AUTH_SOCK"]);

  return {
    host: input.host,
    port: input.port ?? 22,
    username: input.username,
    privateKey: input.privateKey,
    passphrase: input.passphrase,
    password: hasPassword ? input.password : undefined,
    agent: resolvedAgent,
    readyTimeout: SSH_READY_TIMEOUT_MS,
    keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
    keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
    tryKeyboard: hasPassword,
  };
}

export function createKeyboardInteractiveResponder(password?: string) {
  return (
    _name: string,
    _instructions: string,
    _lang: string,
    prompts: Array<{ prompt: string; echo: boolean }>,
    finish: (responses: string[]) => void,
  ) => {
    if (!password || prompts.length === 0) {
      finish([]);
      return;
    }

    finish(prompts.map(() => password));
  };
}

export function normalizeSSHConnectError(error: unknown): Error {
  if (
    typeof error === "object" &&
    error !== null &&
    "level" in error &&
    (error as { level?: string }).level === "client-authentication"
  ) {
    return authenticationError("SSH 认证失败：请检查用户名、密码或私钥配置", error);
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "level" in error &&
    (error as { level?: string }).level === "client-timeout"
  ) {
    return new Error(
      `SSH connection handshake timed out：未能在 ${SSH_READY_TIMEOUT_MS / 1000} 秒inner建立 SSH Session，请CheckNetwork、Server SSH ServiceorTerminal SSH ConfigurationVariance`,
    );
  }

  if (error instanceof Error) {
    if (isMissingPrivateKeyPassphraseMessage(error.message)) {
      return authenticationError("SSH 私钥需要口令：检测到加密私钥，但当前未提供私钥口令", error);
    }
    if (isInvalidPrivateKeyPassphraseMessage(error.message)) {
      return authenticationError("SSH 私钥口令错误：无法解密私钥，请检查私钥口令是否正确", error);
    }
    return error;
  }

  if (typeof error === "string" && error.length > 0) {
    return new Error(error);
  }

  return new Error("SSH 连接失败");
}

function authenticationError(message: string, cause: unknown): Error {
  return Object.assign(new Error(message, { cause }), {
    code: "remote-authentication-failed" satisfies PublicCfErrorCode,
  });
}
