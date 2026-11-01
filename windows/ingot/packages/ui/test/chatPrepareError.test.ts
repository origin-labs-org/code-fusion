import { describe, expect, it } from "vitest";
import {
  buildCachedWorkspacePrepareUiError,
  buildWorkspacePrepareUiError,
  getChatErrorMessage,
} from "@/lib/chatPrepareError.js";

describe("chatPrepareError", () => {
  it("Can extract message from structured objects to avoid [object Object]", () => {
    const message = getChatErrorMessage({
      code: -32000,
      message: "Authentication required",
    });

    expect(message).toBe("Authentication required");
  });

  it("Supports handling cases where message is an object", () => {
    const message = getChatErrorMessage({
      message: {
        error: "token expired",
        status: 401,
      },
    });

    expect(message).toBe('{"error":"token expired","status":401}');
  });

  it("workspace warm-up error complements fallback code and context detail", () => {
    const uiError = buildWorkspacePrepareUiError(
      { code: -32000, message: "Authentication required" },
      {
        workspacePath: "/repo/demo",
        provider: "glm",
        reason: "mount",
        attempt: 2,
        maxAttempts: 5,
      },
    );

    expect(uiError).toMatchObject({
      code: "WORKSPACE_PREPARE_FAILED",
      message: "Authentication required",
      detail: "workspace=/repo/demo provider=glm reason=mount attempt=2/5",
    });
  });

  it("Keep existing detail and do not overwrite real backend details", () => {
    const uiError = buildWorkspacePrepareUiError(
      {
        message: "Authentication required",
        detail: "server detail",
      },
      {
        workspacePath: "/repo/demo",
        provider: "glm",
        reason: "retry",
        attempt: 3,
        maxAttempts: 5,
      },
    );

    expect(uiError.detail).toBe("server detail");
  });

  it("Keep protocol data.code when workspace warm-up error replaces display text", () => {
    const uiError = buildWorkspacePrepareUiError(
      {
        code: -32603,
        data: {
          code: "model_config_missing",
        },
        message:
          "Model config is missing. Create ~/.cf/cli/config.json with an explicit model provider before running CodeFusion.",
      },
      {
        workspacePath: "/repo/demo",
        provider: "glm",
        reason: "mount",
        attempt: 5,
        maxAttempts: 5,
        displayMessage:
          "Model config is missing. Create ~/.cf/cli/config.json with an explicit model provider before running CodeFusion.",
      },
    );

    expect(uiError).toMatchObject({
      code: "model_config_missing",
      message:
        "Model config is missing. Create ~/.cf/cli/config.json with an explicit model provider before running CodeFusion.",
    });
  });

  it("Reuse structured error code on workspace failed cache short-circuit", () => {
    const message =
      "Model config is missing. Create ~/.cf/cli/config.json with an explicit model provider before running CodeFusion.";
    const cachedError = buildWorkspacePrepareUiError(
      {
        code: -32603,
        data: {
          code: "model_config_missing",
        },
        message,
      },
      {
        workspacePath: "/repo/demo",
        provider: "glm",
        reason: "mount",
        attempt: 5,
        maxAttempts: 5,
        displayMessage: message,
      },
    );

    const uiError = buildCachedWorkspacePrepareUiError(message, cachedError, {
      workspacePath: "/repo/demo",
      provider: "glm",
      reason: "mount",
      attempt: 5,
      maxAttempts: 5,
    });

    expect(uiError).toMatchObject({
      code: "model_config_missing",
      message,
    });
  });
});
