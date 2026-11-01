import { delimiter, dirname } from "node:path";

export function withPinnedNodePath(env, nodeExecutablePath) {
  const nodeDirectory = dirname(nodeExecutablePath);
  const pathKey = typeof env.PATH === "string" ? "PATH" : "Path";
  const existingPath = typeof env[pathKey] === "string" ? env[pathKey] : "";
  const pathEntries = existingPath
    .split(delimiter)
    .filter(Boolean)
    .filter((entry) => entry !== nodeDirectory);

  return {
    ...env,
    [pathKey]: [nodeDirectory, ...pathEntries].join(delimiter),
  };
}
