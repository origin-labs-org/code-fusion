import type { Logger } from "@origin-ai/cf-contracts";

interface NormalizeModelToolInputOptions {
  logger?: Logger;
  source: "generateText" | "streamText";
  toolName?: string;
}

export function normalizeModelToolInput(
  input: unknown,
  options: NormalizeModelToolInputOptions,
): unknown {
  if (input === undefined) {
    return {};
  }
  if (input === null) {
    warnAndRecoverMalformedToolInput(new TypeError("Model tool input must not be null"), options, {
      inputType: "null",
    });
    return {};
  }
  if (typeof input !== "string") {
    return input;
  }
  if (input.length === 0) {
    return {};
  }

  try {
    const normalizedInput = JSON.parse(stripByteOrderMark(input));
    if (normalizedInput === null) {
      throw new TypeError("Model tool input must not be null");
    }
    return normalizedInput;
  } catch (error) {
    warnAndRecoverMalformedToolInput(error, options, {
      inputLength: input.length,
    });
    return {};
  }
}

function warnAndRecoverMalformedToolInput(
  error: unknown,
  options: NormalizeModelToolInputOptions,
  inputContext: { inputLength: number } | { inputType: "null" },
): void {
  options.logger?.warn("Model tool input JSON normalization failed", {
    event: "model.tool_input.normalize_failed",
    ...inputContext,
    module: "adapters.model.tool-input-normalization",
    parseErrorType: parseErrorType(error),
    recovery: "empty_object",
    source: options.source,
    status: "failed",
    toolName: options.toolName,
  });
}

function stripByteOrderMark(input: string): string {
  return input.startsWith("\uFEFF") ? input.slice(1) : input;
}

function parseErrorType(error: unknown): string {
  return error instanceof Error && error.name ? error.name : typeof error;
}
