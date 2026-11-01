import type { ExecutionShellSelection } from "@origin-ai/cf-contracts";

const ENABLE_EMBEDDED_SEARCH_BASH_PRELUDE = true;

export function shouldInjectEmbeddedSearchBashPrelude(): boolean {
  return ENABLE_EMBEDDED_SEARCH_BASH_PRELUDE;
}

export function supportsEmbeddedSearchShellSelection(
  selection: ExecutionShellSelection | undefined,
): boolean {
  return selection?.dialect === "posix" || selection?.dialect === "git-bash";
}
