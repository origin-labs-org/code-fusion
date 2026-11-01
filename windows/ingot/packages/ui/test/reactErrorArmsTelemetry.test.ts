import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArmsCustomEventPayload } from "@origin-ai/cf-shared";
import {
  REACT_ERROR_ARMS_EVENT_NAME,
  REACT_ERROR_ARMS_GROUP,
  REACT_ERROR_STACK_MAX_LEN,
  clearReactErrorArmsReporterForTest,
  reportReactErrorToArms,
  setReactErrorArmsReporter,
} from "@/lib/reactErrorArmsTelemetry.js";

function makeReporter() {
  const calls: ArmsCustomEventPayload[] = [];
  return {
    calls,
    reportArmsCustomEvent: vi.fn(async (payload: ArmsCustomEventPayload) => {
      calls.push(payload);
    }),
  };
}

afterEach(() => {
  clearReactErrorArmsReporterForTest();
  vi.restoreAllMocks();
});

describe("reportReactErrorToArms", () => {
  it("未注入 reporter 时静默 no-op，不抛错", () => {
    expect(() =>
      reportReactErrorToArms({
        error: new Error("boom"),
        componentStack: "at Foo",
      }),
    ).not.toThrow();
  });

  it("Reports via perf_react_error/react_error after injection, carrying error diagnostic fields", () => {
    const reporter = makeReporter();
    setReactErrorArmsReporter(reporter);

    const error = new Error("Maximum update depth exceeded");
    error.name = "Error";
    error.stack = "Error: Maximum update depth exceeded\n    at Settings";

    reportReactErrorToArms({
      error,
      componentStack: "\n    at Settings\n    at Root",
      scope: "settings",
    });

    expect(reporter.calls).toHaveLength(1);
    const payload = reporter.calls[0]!;
    expect(payload.name).toBe(REACT_ERROR_ARMS_EVENT_NAME);
    expect(payload.group).toBe(REACT_ERROR_ARMS_GROUP);
    expect(payload.value).toBe(1);
    expect(payload.properties?.error_name).toBe("Error");
    expect(payload.properties?.error_message).toBe("Maximum update depth exceeded");
    expect(payload.properties?.error_stack).toContain("at Settings");
    expect(payload.properties?.component_stack).toContain("at Root");
    expect(payload.properties?.boundary_scope).toBe("settings");
  });

  it("boundary_scope defaults to app (root boundary) when scope is missing", () => {
    const reporter = makeReporter();
    setReactErrorArmsReporter(reporter);

    reportReactErrorToArms({ error: new Error("boom"), componentStack: "" });

    expect(reporter.calls[0]!.properties?.boundary_scope).toBe("app");
  });

  it("Truncates overly long stack / componentStack to the limit to avoid ARMS field overflow", () => {
    const reporter = makeReporter();
    setReactErrorArmsReporter(reporter);

    const longStack = "x".repeat(REACT_ERROR_STACK_MAX_LEN + 5000);
    const error = new Error("boom");
    error.stack = longStack;

    reportReactErrorToArms({ error, componentStack: longStack });

    const props = reporter.calls[0]!.properties!;
    expect((props.error_stack as string).length).toBeLessThanOrEqual(REACT_ERROR_STACK_MAX_LEN);
    expect((props.component_stack as string).length).toBeLessThanOrEqual(REACT_ERROR_STACK_MAX_LEN);
  });

  it("Swallows exceptions when reporter rejects without bubbling (observability pipeline must not affect UI recovery)", () => {
    const reporter = {
      reportArmsCustomEvent: vi.fn(() => Promise.reject(new Error("network down"))),
    };
    setReactErrorArmsReporter(reporter);

    expect(() =>
      reportReactErrorToArms({ error: new Error("boom"), componentStack: "" }),
    ).not.toThrow();
  });

  it("Returns to no-op after clearReactErrorArmsReporterForTest", () => {
    const reporter = makeReporter();
    setReactErrorArmsReporter(reporter);
    clearReactErrorArmsReporterForTest();

    reportReactErrorToArms({ error: new Error("boom"), componentStack: "" });

    expect(reporter.calls).toHaveLength(0);
  });

  it("Sanitizes local machine paths in stack and componentStack", () => {
    const reporter = makeReporter();
    setReactErrorArmsReporter(reporter);

    const error = new Error("boom");
    error.stack = "Error: boom\n    at render (file:///Users/alice/cf/app/index.js:10:5)";

    reportReactErrorToArms({
      error,
      componentStack: "    at Settings (/Users/alice/cf/src/SettingsPage.tsx:42:7)",
    });

    const properties = reporter.calls[0]?.properties;
    expect(String(properties?.error_stack)).not.toContain("alice");
    expect(String(properties?.component_stack)).not.toContain("alice");
    expect(String(properties?.error_stack)).toContain("{path}");
  });

  it("Sanitizes emails and credentials in message, preserving normal diagnostic text", () => {
    const reporter = makeReporter();
    setReactErrorArmsReporter(reporter);

    reportReactErrorToArms({
      error: new Error("render failed for bob@example.com token=abcdef123456"),
      componentStack: "at Foo",
    });
    expect(String(reporter.calls[0]?.properties?.error_message)).not.toContain("bob@example.com");
    expect(String(reporter.calls[0]?.properties?.error_message)).not.toContain("abcdef123456");

    reportReactErrorToArms({
      error: new Error("Maximum update depth exceeded"),
      componentStack: "at Foo",
    });
    expect(reporter.calls[1]?.properties?.error_message).toBe("Maximum update depth exceeded");
  });
});
