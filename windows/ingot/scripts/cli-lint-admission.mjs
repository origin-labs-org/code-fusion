import { posix } from "node:path";

export function parseLintCommand(command) {
  if (!/^oxlint(?: [\w./*-]+)*$/u.test(command) || /(?:--format| -f)(?: |$)/u.test(command))
    throw new Error(`不支持的 CLI lint Command：${command}`);
  return command.split(" ").slice(1);
}

export function classifyLintDiagnostics(diagnostics, { relativeDirectory, pristine }) {
  const accepted = [],
    errors = [],
    warnings = [];
  for (const diagnostic of diagnostics) {
    const path = posix.normalize(
      posix.join(relativeDirectory, diagnostic.filename.replaceAll("\\", "/")),
    );
    if (diagnostic.severity !== "error") warnings.push(diagnostic);
    else if (diagnostic.code === "eslint(max-lines)" && pristine.has(path))
      accepted.push(diagnostic);
    else errors.push(diagnostic);
  }
  return { accepted, errors, warnings };
}
