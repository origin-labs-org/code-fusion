import {
  runProbeCommand,
  type ProcessProbeExecFile,
  type ProcessProbeSample,
} from "./process-probe-shared.js";

export async function readWindowsProcessMemory(
  execFile: ProcessProbeExecFile,
  pids: readonly number[],
): Promise<readonly ProcessProbeSample[]> {
  const stdout = await runProbeCommand(execFile, "tasklist", ["/FO", "CSV", "/NH"], {
    windowsHide: true,
  });
  const wanted = new Set(pids);
  const samples: ProcessProbeSample[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const fields = parseCsvFields(line);
    const pid = Number(fields[1]);
    if (!wanted.has(pid)) continue;
    const memoryDigits = (fields[4] ?? "").replace(/\D/g, "");
    if (!memoryDigits) continue;
    const rssKb = Number(memoryDigits);
    if (!Number.isFinite(rssKb) || rssKb < 0) continue;
    samples.push({ pid, rssKb });
  }
  return samples;
}

function parseCsvFields(line: string): string[] {
  const fields: string[] = [];
  for (const match of line.matchAll(/"((?:[^"]|"")*)"/g)) {
    fields.push((match[1] ?? "").replace(/""/g, '"'));
  }
  return fields;
}
