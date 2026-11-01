import { describe, expect, it } from "vitest";
import { redactArmsEventBatch } from "../src/main/armsEventRedaction.js";

function clickEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_type: "click",
    type: "click",
    name: "click on button: Refactor login flow in src/auth...",
    target_name: "div[1]/div[3]/button[2]",
    duration: 12,
    snapshots: JSON.stringify({
      id: "task-item-8",
      className: "task-list-item selected",
      src: "file:///Users/alice/project/preview.png",
    }),
    ...overrides,
  };
}

describe("redactArmsEventBatch - click", () => {
  it("Strip element text from name, keeping only the tag prefix", () => {
    const [event] = redactArmsEventBatch([clickEvent()]);
    expect(event!.name).toBe("click on button");
  });

  it("Keep input type prefix to easily distinguish controls", () => {
    const [event] = redactArmsEventBatch([
      clickEvent({ name: "click on checkbox-input: Enable auto-submit..." }),
    ]);
    expect(event!.name).toBe("click on checkbox-input");
  });

  it("Delete snapshots to prevent href/src from leaking local paths", () => {
    const [event] = redactArmsEventBatch([clickEvent()]);
    expect(event!.snapshots).toBeUndefined();
  });

  it("Retain structured fields like target_name and duration", () => {
    const [event] = redactArmsEventBatch([clickEvent()]);
    expect(event!.target_name).toBe("div[1]/div[3]/button[2]");
    expect(event!.duration).toBe(12);
  });

  it("Keep names without text suffixes as-is", () => {
    const [event] = redactArmsEventBatch([clickEvent({ name: "click on button" })]);
    expect(event!.name).toBe("click on button");
  });

  it("Discard name into a fixed bucket when not in expected format, instead of passing through as-is", () => {
    const [event] = redactArmsEventBatch([clickEvent({ name: "用户自定义标题：机密项目" })]);
    expect(event!.name).toBe("click");
  });
});

describe("redactArmsEventBatch - exception", () => {
  it("Redact absolute paths and emails in message", () => {
    const [event] = redactArmsEventBatch([
      {
        event_type: "exception",
        type: "error",
        message: "ENOENT open '/Users/alice/work/secret-project/src/a.ts' for bob@example.com",
      },
    ]);
    expect(event!.message).not.toContain("alice");
    expect(event!.message).not.toContain("secret-project");
    expect(event!.message).not.toContain("bob@example.com");
  });

  it("Redact file:// paths in stack", () => {
    const [event] = redactArmsEventBatch([
      {
        event_type: "exception",
        type: "error",
        stack: "at render (file:///Users/carol/app/index.js:10:5)",
      },
    ]);
    expect(event!.stack).not.toContain("carol");
  });

  it("Redact Windows install directory in file field without leaking local username", () => {
    const [event] = redactArmsEventBatch([
      {
        event_type: "exception",
        type: "error",
        source: "uncaughtException",
        message: "boom",
        file: "file:///C:/Users/erin/AppData/Local/Programs/CodeFusion/resources/app.asar/dist/renderer/assets/index-9f3a.js",
        line: 1,
        column: 2345,
      },
    ]);
    expect(String(event!.file)).not.toContain("erin");
    expect(event!.line).toBe(1);
    expect(event!.column).toBe(2345);
  });

  it("Redact whiteScreen snapshots text", () => {
    const [event] = redactArmsEventBatch([
      {
        event_type: "exception",
        type: "blank",
        snapshots: JSON.stringify({ url: "file:///Users/dave/app/index.html", when: 1 }),
      },
    ]);
    expect(String(event!.snapshots)).not.toContain("dave");
  });

  it("Do not rewrite binary_images decision fields of native crashReporter dump events", () => {
    const binaryImages = [{ name: "cf" }];
    const [event] = redactArmsEventBatch([
      {
        event_type: "exception",
        type: "crash",
        source: "crashReporter",
        message: "EXC_BAD_ACCESS",
        binary_images: binaryImages,
      },
    ]);
    expect(event!.binary_images).toBe(binaryImages);
  });

  it("Standard diagnostic messages are not rewritten", () => {
    const [event] = redactArmsEventBatch([
      {
        event_type: "exception",
        type: "error",
        message: "Cannot read properties of undefined (reading 'id')",
      },
    ]);
    expect(event!.message).toBe("Cannot read properties of undefined (reading 'id')");
  });
});

describe("redactArmsEventBatch - api / resource", () => {
  it("Drop url query and fragment", () => {
    const [event] = redactArmsEventBatch([
      {
        event_type: "resource",
        type: "api",
        url: "https://cf.z.ai/api/v1/event/report?state=abc123#x",
        name: "https://cf.z.ai/api/v1/event/report?state=abc123",
      },
    ]);
    expect(event!.url).toBe("https://cf.z.ai/api/v1/event/report");
    expect(event!.name).toBe("https://cf.z.ai/api/v1/event/report");
  });

  it("归一化路由里的 UUID 身份段", () => {
    const [event] = redactArmsEventBatch([
      {
        event_type: "resource",
        type: "api",
        url: "https://cf.z.ai/api/v1/tasks/0f8fad5b-d9cb-469f-a165-70867728950e/messages",
      },
    ]);
    expect(event!.url).toBe("https://cf.z.ai/api/v1/tasks/{segment}/messages");
  });

  it("Redact error message in api events", () => {
    const [event] = redactArmsEventBatch([
      {
        event_type: "resource",
        type: "api",
        url: "https://cf.z.ai/api/v1/ping",
        message: "connect ECONNREFUSED for /Users/erin/.cf/socket",
      },
    ]);
    expect(event!.message).not.toContain("erin");
  });

  it("本地静态资源归一为 local_file", () => {
    const [event] = redactArmsEventBatch([
      {
        event_type: "resource",
        type: "img",
        url: "file:///Users/frank/app/logo.png",
      },
    ]);
    expect(event!.url).toBe("local_file");
  });
});

describe("redactArmsEventBatch - 不影响其他事件", () => {
  it("Retain longTask attribution summary properties", () => {
    const properties = { loaf_top_invoker_type: "user-callback", loaf_top_share_pct: 62 };
    const [event] = redactArmsEventBatch([{ event_type: "longTask", duration: 120, properties }]);
    expect(event!.properties).toBe(properties);
  });

  it("自定义事件（perf_*）不被本批次改写", () => {
    const input = {
      event_type: "custom",
      name: "perf_agent_crash",
      properties: { error_message: "<workspace>/src/a.ts failed" },
    };
    const [event] = redactArmsEventBatch([input]);
    expect(event!.properties).toEqual({ error_message: "<workspace>/src/a.ts failed" });
  });

  it("保持批次顺序与条数，空批次安全", () => {
    expect(redactArmsEventBatch([])).toEqual([]);
    const events = redactArmsEventBatch([
      { event_type: "view", type: "perf" },
      clickEvent(),
      { event_type: "exception", type: "error", message: "boom" },
    ]);
    expect(events).toHaveLength(3);
    expect(events[0]!.type).toBe("perf");
    expect(events[1]!.name).toBe("click on button");
    expect(events[2]!.message).toBe("boom");
  });
});
