import {
  ARMS_CUSTOM_EVENT_PROPERTY_LIMIT,
  PROCESS_RESOURCE_EVENT_NAMES,
  checkProcessResourceEventProperties,
} from "@origin-ai/cf-shared";
import { clearAppData, waitForDefaultWorkspaceReady } from "./helpers/desktop-app.js";

interface FinalArmsEntry {
  payload: { name: string; group: string; value: number; properties: Record<string, string> };
}

interface FinalArmsBridgeWindow extends Window {
  __cfFinalArmsCustomEventsE2E?: {
    read(): Promise<FinalArmsEntry[]>;
    clear(): Promise<void>;
    configure(request: { suppressedEventNames: string[] }): Promise<void>;
  };
}

const PROCESS_WINDOW_EVENT = PROCESS_RESOURCE_EVENT_NAMES.processWindow;
const SYSTEM_WINDOW_EVENT = PROCESS_RESOURCE_EVENT_NAMES.systemWindow;
const REQUIRED_ROLES = ["main", "renderer_main", "host"] as const;

const HEAP_CAPABLE_ROLES = ["main", "host", "scheduler", "renderer_main", "cli_chat", "cli_aux"];

const WINDOW_WAIT_MS = 100_000;

describe("进程资源遥测 ARMS 角色事件", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("PRT-023: Read perf_process_window and perf_system_window of main / renderer_main / host after 1-minute window, property count <= 20", async function () {
    this.timeout(WINDOW_WAIT_MS + 60_000);

    await waitForDefaultWorkspaceReady(30_000);

    const bridgeReady = await browser.execute(
      async (suppressed: string[]) => {
        const bridge = (window as FinalArmsBridgeWindow).__cfFinalArmsCustomEventsE2E;
        if (!bridge) return false;
        await bridge.configure({ suppressedEventNames: suppressed });
        return true;
      },
      [PROCESS_WINDOW_EVENT, SYSTEM_WINDOW_EVENT],
    );
    if (!bridgeReady) {
      throw new Error("当前 E2E 会话没有开启 final ARMS custom event 桥");
    }

    let entries: FinalArmsEntry[] = [];
    await browser.waitUntil(
      async () => {
        entries = await browser.execute(async () => {
          const bridge = (window as FinalArmsBridgeWindow).__cfFinalArmsCustomEventsE2E;
          return bridge ? await bridge.read() : [];
        });
        const roles = new Set(
          entries
            .filter((entry) => entry.payload.name === PROCESS_WINDOW_EVENT)
            .map((entry) => entry.payload.properties.process_role),
        );
        const hasSystemWindow = entries.some((entry) => entry.payload.name === SYSTEM_WINDOW_EVENT);
        return REQUIRED_ROLES.every((role) => roles.has(role)) && hasSystemWindow;
      },
      {
        timeout: WINDOW_WAIT_MS,
        interval: 2_000,
        timeoutMsg: `1 分钟趋势Window过后仍未读到 ${REQUIRED_ROLES.join(" / ")} 的 ${PROCESS_WINDOW_EVENT} 与 ${SYSTEM_WINDOW_EVENT}`,
      },
    );

    const processWindowEvents = entries.filter(
      (entry) => entry.payload.name === PROCESS_WINDOW_EVENT,
    );
    for (const entry of processWindowEvents) {
      expect(entry.payload.group).toBe("resource");
      expect(
        checkProcessResourceEventProperties(PROCESS_WINDOW_EVENT, entry.payload.properties).ok,
      ).toBe(true);
      expect(Object.keys(entry.payload.properties).length).toBeLessThanOrEqual(
        ARMS_CUSTOM_EVENT_PROPERTY_LIMIT,
      );
      expect(Number(entry.payload.properties.sample_count)).toBeGreaterThan(0);
      expect(entry.payload.properties.runtime_surface).toBe("local");
      expect(entry.payload.properties).not.toHaveProperty("environmentKey");
      expect(entry.payload.properties).not.toHaveProperty("completionToken");
      if (entry.payload.properties.heap_used_kb_mean !== undefined) {
        expect(HEAP_CAPABLE_ROLES).toContain(entry.payload.properties.process_role);
        expect(Number(entry.payload.properties.heap_used_kb_mean)).toBeGreaterThan(0);
        expect(Number(entry.payload.properties.heap_used_kb_peak)).toBeGreaterThanOrEqual(
          Number(entry.payload.properties.heap_used_kb_mean),
        );
      }
    }

    const systemWindowEvents = entries.filter(
      (entry) => entry.payload.name === SYSTEM_WINDOW_EVENT,
    );
    for (const entry of systemWindowEvents) {
      expect(entry.payload.group).toBe("resource");
      expect(
        checkProcessResourceEventProperties(SYSTEM_WINDOW_EVENT, entry.payload.properties).ok,
      ).toBe(true);
      expect(Object.keys(entry.payload.properties)).toHaveLength(17);
      expect(Number(entry.payload.properties.sample_count)).toBeGreaterThan(0);
      expect(Number(entry.payload.properties.app_rss_kb_total_peak)).toBeGreaterThan(0);
      expect(Number(entry.payload.properties.telemetry_self_ms)).toBeGreaterThanOrEqual(0);
    }

    const eventNames = entries.map((entry) => entry.payload.name);
    expect(eventNames).not.toContain("perf_resource_window");
    expect(eventNames).not.toContain("perf_resource_agent");
    expect(eventNames).not.toContain("perf_mcp_memory");
  });
});
