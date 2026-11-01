function redactUnquotedPath(value: string): string {
  const suffix =
    value.match(
      /(?:\s+(?:failed with exit code -?\d+|permission denied|no space left on device|read-only file system|[\w-]+=\[redacted\]))+\.?$/iu,
    )?.[0] ?? "";
  return `[redacted-path]${suffix}`;
}

function secretTokenPattern(secret: string): RegExp {
  const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const before = /^\w/.test(secret) ? "(?<!\\w)" : "";
  const after = /\w$/.test(secret) ? "(?!\\w)" : "";
  return new RegExp(`${before}${escaped}${after}`, "g");
}

export function sanitizeRemoteConnectionLog(
  message: string,
  secrets: readonly string[] = [],
): string {
  let result = message;
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.replace(secretTokenPattern(secret), "[redacted]");
  }
  return (
    result
      .replace(/-----BEGIN [\s\S]*?-----END [^-]+-----/g, "[redacted]")
      .replace(
        /(["'](?:authorization|(?:set-)?cookie)["'][ \t]*[:=][ \t]*)(?:\[redacted\](?=[,}\]\r\n]|$)|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\r\n]*)/gi,
        "$1[redacted]",
      )
      .replace(/(\b(?:authorization|(?:set-)?cookie)[ \t]*[:=][ \t]*)[^\r\n]*/gi, "$1[redacted]")
      .replace(/\b(Bearer|Basic)[ \t]+[^\s,"'};]+/gi, "$1 [redacted]")
      .replace(
        /(["']?(?:[\w-]*token|[\w-]*api[_-]?key|[\w-]*secret|password|passphrase|privateKey|credentialRef|credentialId|profileId|sourceServerId|serverId|deviceId)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi,
        "$1[redacted]",
      )
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted]")
      .replace(/(?:https?|wss?|file):\/\/[^\s"'<>]+/gi, "[redacted-url]")
      .replace(/"(?:~?\/|[A-Za-z]:[\\/]|\\\\)(?:\\[^\r\n]|[^"\\\r\n])*"/g, "[redacted-path]")
      .replace(/'(?:~?\/|[A-Za-z]:[\\/]|\\\\)[^'\r\n]*'/g, "[redacted-path]")
      .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n"'<>]+/g, redactUnquotedPath)
      .replace(
        /(^|[\s("'=:[])(~?\/[^\r\n"'<>),;]+)/g,
        (_match, prefix: string, path: string) => `${prefix}${redactUnquotedPath(path)}`,
      )
      .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
      .trim()
  );
}

export function remoteConnectionFailureLogLevel(code: string): "info" | "error" {
  return code === "source-server-install-required" ||
    code === "remote-connection-canceled" ||
    code === "remote-bind-canceled"
    ? "info"
    : "error";
}
