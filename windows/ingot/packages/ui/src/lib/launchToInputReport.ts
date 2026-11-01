import type { LaunchMarks } from "@origin-ai/cf-shared";

export function shouldReportLaunchToInput(state: {
  isStartupRenderBlocked: boolean;
  welcomeScreenOpen: boolean;
  alreadyReported: boolean;
}): boolean {
  return !state.alreadyReported && !state.isStartupRenderBlocked && !state.welcomeScreenOpen;
}

export function readRendererLaunchTimings(): {
  marks: LaunchMarks | null;
  rendererStart: number;
  reactCommit: number;
} | null {
  const w = window as Window & {
    __CF_LAUNCH_MARKS__?: LaunchMarks | null;
    __CF_RENDERER_START__?: number;
    __CF_REACT_COMMIT_AT__?: number;
  };
  const rendererStart = w.__CF_RENDERER_START__;
  const reactCommit = w.__CF_REACT_COMMIT_AT__;
  if (typeof rendererStart !== "number" || typeof reactCommit !== "number") {
    return null;
  }
  return { marks: w.__CF_LAUNCH_MARKS__ ?? null, rendererStart, reactCommit };
}
