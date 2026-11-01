import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserRecordingArtifact, BrowserViewportSize } from "@origin-ai/cf-shared";

export interface BrowserWebmRecorderFactoryInput {
  outputPath: string;
  targetFrame: unknown;
  viewport: BrowserViewportSize;
  fps: number;
  signal: AbortSignal;
}

export interface BrowserWebmRecorderSession {
  
  stop(): Promise<void>;
  
  cancel(): Promise<void>;
}

export type BrowserWebmRecorderFactory = (
  input: BrowserWebmRecorderFactoryInput,
) => Promise<BrowserWebmRecorderSession>;

function abortError(message = "Browser recording cancelled"): DOMException {
  return new DOMException(message, "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

export async function recordBrowserVideo(input: {
  targetFrame: unknown;
  tempRoot: string;
  recordingId: string;
  viewport: BrowserViewportSize;
  fps: number;
  signal: AbortSignal;
  executeScenario(): Promise<void>;
  onPhase?(phase: "capturing" | "finalizing"): void;
  onCaptureComplete?(): void;
  createRecorder: BrowserWebmRecorderFactory;
  now?: () => number;
}): Promise<BrowserRecordingArtifact> {
  const outputPath = join(input.tempRoot, `${input.recordingId}.webm`);
  const now = input.now ?? Date.now;
  let recorder: BrowserWebmRecorderSession | undefined;
  let completed = false;

  try {
    throwIfAborted(input.signal);
    recorder = await input.createRecorder({
      outputPath,
      targetFrame: input.targetFrame,
      viewport: input.viewport,
      fps: input.fps,
      signal: input.signal,
    });
    throwIfAborted(input.signal);

    const captureStartedAt = now();
    input.onPhase?.("capturing");
    await input.executeScenario();
    throwIfAborted(input.signal);
    const durationMs = Math.max(0, Math.round(now() - captureStartedAt));

    input.onCaptureComplete?.();
    input.onPhase?.("finalizing");
    await recorder.stop();
    throwIfAborted(input.signal);

    const artifactStat = await stat(outputPath);
    if (!artifactStat.isFile() || artifactStat.size === 0) {
      throw new Error("Browser recording produced an empty WebM artifact");
    }
    completed = true;
    return {
      path: outputPath,
      mimeType: "video/webm",
      width: input.viewport.width,
      height: input.viewport.height,
      fps: input.fps,
      durationMs,
      frameCount: Math.max(1, Math.round((durationMs / 1_000) * input.fps)),
    };
  } finally {
    if (!completed) {
      await recorder?.cancel().catch(() => undefined);
      await rm(outputPath, { force: true }).catch(() => undefined);
    }
  }
}
