export type ProjectMemoryRetrievalBranch = "default-index" | "semantic-recall";

const PROJECT_MEMORY_SEMANTIC_RECALL_ENABLED = false;

export function resolveProjectMemoryRetrievalBranch(
  semanticRecallEnabled: boolean,
): ProjectMemoryRetrievalBranch {
  return semanticRecallEnabled ? "semantic-recall" : "default-index";
}

export const ACTIVE_PROJECT_MEMORY_RETRIEVAL_BRANCH = resolveProjectMemoryRetrievalBranch(
  PROJECT_MEMORY_SEMANTIC_RECALL_ENABLED,
);
