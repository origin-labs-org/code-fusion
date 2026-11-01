import { chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

const BASH_PREFIX_PERMISSION_SPEC =
  "conversation-session-v4-bash-command-prefix-permission.test.ts";
const CASE_RUNTIME_DIR = "conversation-session-v4-bash-command-prefix-permission";

const PNPM_SHIM = `#!/bin/sh
case " $* " in
  *" run lint "*)
    printf "%s\\n" "lint-ok"
    ;;
  *" run test "*)
    printf "%s\\n" "test-ok"
    ;;
  *)
    printf "%s\\n" "unsupported deterministic pnpm fixture: $*" >&2
    exit 64
    ;;
esac
`;

export async function installBashPrefixPermissionPnpmShim(params: {
  environment: NodeJS.ProcessEnv;
  homeDir: string;
  specs: readonly string[];
}): Promise<string | undefined> {
  if (!params.specs.some((spec) => spec.includes(BASH_PREFIX_PERMISSION_SPEC))) {
    return undefined;
  }

  const shimDirectory = join(params.homeDir, "CfProject", ".cf-e2e", CASE_RUNTIME_DIR, "bin");
  const shimPath = join(shimDirectory, "pnpm");
  await mkdir(shimDirectory, { recursive: true });
  await writeFile(shimPath, PNPM_SHIM, { encoding: "utf8", mode: 0o755 });
  if (process.platform !== "win32") {
    await chmod(shimPath, 0o755);
  }

  const pathKey =
    Object.keys(params.environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const currentPath = params.environment[pathKey] ?? "";
  const entries = currentPath.split(delimiter).filter(Boolean);
  params.environment[pathKey] = [
    shimDirectory,
    ...entries.filter((entry) => entry !== shimDirectory),
  ].join(delimiter);
  return shimPath;
}
