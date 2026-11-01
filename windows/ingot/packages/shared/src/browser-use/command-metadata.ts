import { z } from "zod";

export const BROWSER_VIEWPORT_LIMITS = {
  minWidth: 320,
  maxWidth: 3840,
  minHeight: 320,
  maxHeight: 2160,
} as const;

export const DEFAULT_AGENT_BROWSER_VIEWPORT = {
  width: 1280,
  height: 720,
} as const;

export const browserViewportSizeSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export type BrowserViewportSize = z.infer<typeof browserViewportSizeSchema>;

export const browserViewportInputSchema = browserViewportSizeSchema.extend({
  width: z
    .number()
    .int()
    .min(BROWSER_VIEWPORT_LIMITS.minWidth)
    .max(BROWSER_VIEWPORT_LIMITS.maxWidth),
  height: z
    .number()
    .int()
    .min(BROWSER_VIEWPORT_LIMITS.minHeight)
    .max(BROWSER_VIEWPORT_LIMITS.maxHeight),
});

export const BROWSER_VIEWPORT_ZOOM_OPTIONS = [
  "fit",
  "50",
  "75",
  "100",
  "125",
  "150",
  "200",
] as const;
export const browserViewportZoomSchema = z.enum(BROWSER_VIEWPORT_ZOOM_OPTIONS);
export type BrowserViewportZoom = z.infer<typeof browserViewportZoomSchema>;

export const DEFAULT_BROWSER_VIEWPORT_ZOOM: BrowserViewportZoom = "fit";

export const embeddedBrowserViewportPreferenceSchema = z
  .object({
    mode: z.enum(["normal", "responsive"]),
    viewport: browserViewportInputSchema,
    zoom: browserViewportZoomSchema,
  })
  .strict();
export type EmbeddedBrowserViewportPreference = z.infer<
  typeof embeddedBrowserViewportPreferenceSchema
>;

export const DEFAULT_EMBEDDED_BROWSER_VIEWPORT_PREFERENCE: EmbeddedBrowserViewportPreference = {
  mode: "normal",
  viewport: { width: 393, height: 852 },
  zoom: DEFAULT_BROWSER_VIEWPORT_ZOOM,
};

export const browserCommandMethodSchema = z.enum([
  "navigate",
  "back",
  "forward",
  "reload",
  "snapshot",
  "click",
  "fill",
  "type",
  "press",
  "cuaKeypress",
  "scroll",
  "cuaScroll",
  "domCuaScroll",
  "hover",
  "select",
  "check",
  "drag",
  "cuaDrag",
  "screenshot",
  "getState",
  "elementInfo",
  "evaluate",
  "getDialog",
  "handleDialog",
  "waitFor",
  "playwright",
  "playwrightWaitForTimeout",
  "capabilities",
  "browserVisibilityGet",
  "browserVisibilitySet",
  "browserViewportSet",
  "browserViewportReset",
  "recordingStart",
  "recordingStatus",
  "recordingCancel",
  "activateTab",
  "newTab",
  "finalize",
  "finalizeTabs",
  "listUserTabs",
  "claimTab",
  "markDeliverable",
  "markHandoff",
  "nameSession",
  "turnEnded",
  "closeSession",
  "cancelRequest",
  "close",
  "list",
]);
export type BrowserCommandMethod = z.infer<typeof browserCommandMethodSchema>;

export const browserClientModeSchema = z.enum(["desktop-continuous", "web-remote-replayable"]);
export type BrowserClientMode = z.infer<typeof browserClientModeSchema>;

export const browserCommandContextSchema = z
  .object({
    
    workspaceKey: z.string().min(1),
    sessionId: z.string().min(1),
    
    tabId: z.string().min(1).optional(),
    requestId: z.string().min(1),
    clientMode: browserClientModeSchema,
  })
  .strict();
export type BrowserCommandContext = z.infer<typeof browserCommandContextSchema>;

export const browserErrorCodeSchema = z.enum([
  "backend_unavailable",
  "capability_unsupported",
  "duplicate_request_id",
  "ref_not_found",
  "navigation_blocked",
  "timeout",
  "renderer_unreachable",
  "cancelled",
  "execution_error",
]);
export type BrowserErrorCode = z.infer<typeof browserErrorCodeSchema>;

export const browserPageStateSchema = z
  .object({
    url: z.string(),
    title: z.string(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    scrollX: z.number().optional(),
    scrollY: z.number().optional(),
    viewportWidth: z.number().optional(),
    viewportHeight: z.number().optional(),
  })
  .strict();
export type BrowserPageState = z.infer<typeof browserPageStateSchema>;
