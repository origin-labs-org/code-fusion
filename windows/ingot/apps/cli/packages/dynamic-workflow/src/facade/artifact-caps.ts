

export const ARTIFACT_CAPS = {
  
  maxArtifactsPerRun: 32,
  
  maxVersionsPerArtifact: 16,
  
  maxFileBytes: 20 * 1024 * 1024,
  
  maxMarkdownBytes: 256 * 1024,
  
  maxTitleLength: 120,
  
  maxDescriptionLength: 500,
  
  maxSpecSerializedBytes: 8 * 1024,
  
  maxIdLength: 64,
} as const;

export const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
