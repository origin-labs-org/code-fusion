export interface RemoteServerBundleValidationInput {
  bundledInputs: string[];
  source: string;
}

const unresolvedUndiciRuntimeImportPattern = /\b(?:require|import)\d*\(["']undici["']\)/;

export function validateRemoteServerBundle({ source }: RemoteServerBundleValidationInput): void {
  const hasUnresolvedUndiciRuntimeImport = unresolvedUndiciRuntimeImportPattern.test(source);

  if (hasUnresolvedUndiciRuntimeImport) {
    throw new Error(
      'Remote server bundle must inline undici. Found unresolved runtime dependency "undici".',
    );
  }
}
