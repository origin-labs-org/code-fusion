export interface E2ERendererBridgeRootHooks {
  beforeAll: () => Promise<void>;
}

export function createE2ERendererBridgeRootHooks(
  runPreflight: () => Promise<void>,
  readBeforeSessionError: () => unknown = () => null,
): E2ERendererBridgeRootHooks {
  return {
    async beforeAll() {
      const beforeSessionError = readBeforeSessionError();
      if (beforeSessionError !== null) {
        throw new Error(
          `e2e-before-session infra failure: ${formatErrorMessage(beforeSessionError)}`,
          beforeSessionError instanceof Error ? { cause: beforeSessionError } : undefined,
        );
      }
      await runPreflight();
    },
  };
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
