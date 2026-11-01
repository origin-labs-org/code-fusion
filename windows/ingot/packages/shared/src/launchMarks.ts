
export interface LaunchMarks {
  
  createdAt: number;
  
  mainStart: number;
  
  appReady: number;
  
  loadUrl: number;
}

export const LAUNCH_MARKS_QUERY_KEY = "cfLaunchMarks";

export function serializeLaunchMarks(marks: LaunchMarks): string {
  return JSON.stringify(marks);
}

export function parseLaunchMarks(raw: string | null | undefined): LaunchMarks | null {
  if (raw == null || raw === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const keys: (keyof LaunchMarks)[] = ["createdAt", "mainStart", "appReady", "loadUrl"];
  const result = {} as LaunchMarks;
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    result[key] = value;
  }
  return result;
}
