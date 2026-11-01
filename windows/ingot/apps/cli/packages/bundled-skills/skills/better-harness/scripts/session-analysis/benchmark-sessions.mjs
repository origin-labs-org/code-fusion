export const BENCHMARK_SESSION_MARKER = "better-harness-benchmark-generated:v1";

export function isBenchmarkGeneratedRecord(raw) {
  if (!raw || typeof raw !== "object") return false;
  try {
    return JSON.stringify(raw).toLowerCase().includes(BENCHMARK_SESSION_MARKER);
  } catch {
    return false;
  }
}

export function isBenchmarkGeneratedText(value) {
  return String(value ?? "").toLowerCase().includes(BENCHMARK_SESSION_MARKER);
}

export function partitionBenchmarkSessions(sessions = [], includeBenchmarkSessions = false) {
  if (includeBenchmarkSessions) {
    return { sessions: [...sessions], excludedCount: 0 };
  }
  const retained = sessions.filter((session) => session?.benchmarkGenerated !== true);
  return { sessions: retained, excludedCount: sessions.length - retained.length };
}
