

export const WORLD_READ_CAPS = {
  
  globMaxFiles: 2000,
  
  grepMaxMatches: 2000,
  
  grepMaxSerializedBytes: 256 * 1024,
  
  gitDiffMaxBytes: 512 * 1024,
  
  gitLogMaxCount: 100,
  
  gitLogDefaultCount: 20,
  
  runStdoutMaxBytes: 256 * 1024,
  
  runStderrMaxBytes: 256 * 1024,
  
  runDefaultTimeoutMs: 300_000,
} as const;
