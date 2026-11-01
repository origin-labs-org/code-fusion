

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const BRIDGE_SYMBOL = Symbol.for("cf.node-repl.computer-use-bridge");

const COMPUTER_METHOD_NAMES = Object.freeze([
  "list_apps",
  "list_windows",
  "get_app_state",
  "left_click",
  "scroll",
  "left_click_drag",
  "type",
  "set_value",
  "select_text",
  "key",
  "perform_action",
  "paste",
  "request_access",
  "stop_computer_control",
]);

const PLATFORM_EXCLUDED_METHODS = Object.freeze({});

const MUTATING_METHODS = new Set([
  "left_click",
  "scroll",
  "left_click_drag",
  "type",
  "set_value",
  "select_text",
  "key",
  "perform_action",
  "paste",
  "stop_computer_control",
]);

const ERROR_CODE_BY_BROKER = Object.freeze({
  permission_denied: "PERMISSION_DENIED",
  not_authorized: "NOT_AUTHORIZED",
  launch_failed: "LAUNCH_FAILED",
  invalid_request: "INVALID_APP",
  element_unavailable: "ELEMENT_UNAVAILABLE",
  not_settable: "NOT_SETTABLE",
  not_selectable: "NOT_SELECTABLE",
  action_unavailable: "ACTION_UNAVAILABLE",
  foreground_required: "FOREGROUND_REQUIRED",
  controller_busy: "CONTROLLER_BUSY",
  broker_unavailable: "HELPER_UNAVAILABLE",
  version_mismatch: "VERSION_MISMATCH",
  stale_socket: "HELPER_UNAVAILABLE",
  timeout: "TIMEOUT",
  unimplemented: "ACTION_UNAVAILABLE",
  method_not_found: "INTERNAL",
  internal: "INTERNAL",
});

const REOBSERVE_CODES = new Set([
  "ELEMENT_UNAVAILABLE",
  "STALE_STATE",
  "STRUCTURED_STATE_UNAVAILABLE",
]);
const NEVER_RETRY_CODES = new Set([
  "CONTROLLER_BUSY",
  "CONTROL_STOPPED",
  "PERMISSION_DENIED",
  "NOT_AUTHORIZED",
  "VERSION_MISMATCH",
  "ACTION_UNAVAILABLE",
  "NOT_SETTABLE",
  "NOT_SELECTABLE",
]);

class ComputerUseError extends Error {
  constructor(message, { code, actionSent, dispatchStatus, details } = {}) {
    super(message);
    this.name = "ComputerUseError";
    this.code = code ?? "INTERNAL";
    this.actionSent = actionSent === true;
    if (dispatchStatus) this.dispatchStatus = dispatchStatus;
    this.details = Object.freeze({ ...(details ?? {}) });
    this.retry = this.actionSent
      ? "reobserve"
      : NEVER_RETRY_CODES.has(this.code)
        ? "never"
        : REOBSERVE_CODES.has(this.code)
          ? "reobserve"
          : "retry";
  }
}

function parseJsonRecord(text) {
  if (typeof text !== "string") return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonValue(text) {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function textBlocks(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text);
}

function receiptOf(result) {
  const candidates = [];
  if (result && typeof result === "object") candidates.push(result);
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    candidates.push(result.structuredContent);
  }
  for (const text of textBlocks(result)) {
    const parsed = parseJsonRecord(text);
    if (!parsed) continue;
    candidates.push(parsed);
    if (parsed.action_outcome && typeof parsed.action_outcome === "object") {
      candidates.push(parsed.action_outcome);
    }
  }
  const merged = {};
  for (const candidate of candidates) {
    for (const key of [
      "state_id",
      "frame_id",
      "action_sent",
      "dispatch_status",
      "state_sync_status",
      "code",
      "reason",
      "snapshot_mode",
      "base_state_id",
    ]) {
      if (merged[key] === undefined && candidate[key] !== undefined) {
        merged[key] = candidate[key];
      }
    }
  }
  return merged;
}

function frameIdOf(result) {
  const receipt = receiptOf(result);
  if (typeof receipt.frame_id === "string") return receipt.frame_id;
  for (const text of textBlocks(result)) {
    const parsed = parseJsonRecord(text);
    const id = parsed?.image_ref?.frame_id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

function brokerErrorCodeOf(result) {
  for (const text of textBlocks(result)) {
    const parsed = parseJsonRecord(text);
    const code = parsed?.code ?? parsed?.error?.code;
    if (typeof code === "string") return code;
  }
  const receipt = receiptOf(result);
  return typeof receipt.code === "string" ? receipt.code : undefined;
}

function messageOf(result, fallback) {
  const texts = textBlocks(result);
  for (const text of texts) {
    const parsed = parseJsonRecord(text);
    if (typeof parsed?.message === "string" && parsed.message) return parsed.message;
  }
  const plain = texts.find((text) => text && !parseJsonRecord(text));
  return plain ?? texts[0] ?? fallback;
}

const NOT_READY_KIND = "CUA_NOT_READY";
const NOT_READY_MAX_ATTEMPTS = 6;
const NOT_READY_BACKOFF_MS = [250, 500, 750, 1000, 1500];

function notReadyEnvelopeOf(result) {
  if (result?.isError === true) return undefined;
  for (const text of textBlocks(result)) {
    const parsed = parseJsonRecord(text);
    if (parsed?.kind === NOT_READY_KIND) return parsed;
  }
  return undefined;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertOk(methodName, result) {
  const receipt = receiptOf(result);
  const isError = result?.isError === true;
  const dispatch = receipt.dispatch_status;
  const actionSent = receipt.action_sent === true;
  if (!isError && dispatch !== "possibly_sent") return receipt;
  const brokerCode = brokerErrorCodeOf(result);
  const code = isError
    ? (ERROR_CODE_BY_BROKER[brokerCode] ?? "INTERNAL")
    : "TIMEOUT";
  throw new ComputerUseError(
    messageOf(result, `${methodName} failed`),
    {
      code,
      actionSent: actionSent || dispatch === "possibly_sent",
      dispatchStatus: dispatch,
      details: { method: methodName, ...(brokerCode ? { brokerCode } : {}) },
    },
  );
}

function bindTarget(binding, target, what) {
  if (typeof target === "number") {
    if (!Number.isInteger(target) || target < 0) {
      throw new ComputerUseError(
        `${what} element index must be a non-negative integer (got ${target})`,
        { code: "INTERNAL" },
      );
    }
    if (!binding.stateId) {
      throw new ComputerUseError(
        `${what} needs a fresh accessibility state before an element index can be resolved. ` +
          `Call getAXState() on the bound app first (the object getApp(...) returned), then act in the same cell.`,
        { code: "STALE_STATE", details: { need: "getAXState" } },
      );
    }
    return { type: "element", index: target };
  }
  if (Array.isArray(target) && target.length === 2) {
    const [x, y] = target;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
      throw new ComputerUseError(
        `${what} coordinate must be two non-negative integer pixels of the latest raster (got [${x}, ${y}])`,
        { code: "INTERNAL" },
      );
    }
    //
    //
    //
    return binding.frameId
      ? { type: "coordinate", frame_id: binding.frameId, x, y }
      : { type: "coordinate", x, y };
  }
  throw new ComputerUseError(
    `${what} target must be an element index (number) or a raster pixel ([x, y])`,
    { code: "INTERNAL" },
  );
}

function looksLikeBundleId(target) {
  return target.includes(".") && !/[\s/]/u.test(target);
}

function appRefFor(target, windowId) {
  const field = looksLikeBundleId(target) ? "bundle_id" : "name";
  return { [field]: target, ...(windowId === undefined ? {} : { window_id: windowId }) };
}

function alternateAppRef(target, windowId) {
  const field = looksLikeBundleId(target) ? "name" : "bundle_id";
  return { [field]: target, ...(windowId === undefined ? {} : { window_id: windowId }) };
}

function isAppNotFound(result) {
  if (!result?.isError) return false;
  return textBlocks(result).some((text) =>
    /target app is not running/u.test(text),
  );
}

const DIRECTIONS = new Set(["up", "down", "left", "right", "u", "d", "l", "r"]);
const LONG_DIRECTION = { u: "up", d: "down", l: "left", r: "right" };
const MOUSE_BUTTONS = { left: "left", right: "right", middle: "middle", l: "left", r: "right", m: "middle" };

function emitText(globals, text, options) {
  if (options?.emit === false) return;
  try {
    globals.nodeRepl?.write?.(text);
  } catch {
  }
}

function isFrameAuthorityText(value) {
  const parsed = parseJsonRecord(value);
  return Boolean(
    parsed && Object.keys(parsed).length === 1 && Object.hasOwn(parsed, "image_ref"),
  );
}

function projectToHost(globals, result) {
  const sink = globals.nodeRepl?.emitStructuredResult;
  if (typeof sink !== "function" || !result || !Array.isArray(result.content)) return;
  const media = result.content.filter(
    (block) => block?.type === "image" || (block?.type === "text" && isFrameAuthorityText(block.text)),
  );
  if (media.length > 0) {
    //
    //
    const { structuredContent: raw, ...rest } = result;
    const structured = raw && typeof raw === "object" ? forDisplay(raw) : undefined;
    sink({ ...rest, content: media, ...(structured ? { structuredContent: structured } : {}) });
    return;
  }
  if (result.isError === true) {
    sink(result);
    return;
  }
  const meta = result._meta && typeof result._meta === "object" ? result._meta : undefined;
  const structured =
    result.structuredContent && typeof result.structuredContent === "object"
      ? result.structuredContent
      : undefined;
  if (!meta && !structured) return;
  sink({
    content: [],
    ...(structured ? { structuredContent: forDisplay(structured) } : {}),
    ...(meta ? { _meta: meta } : {}),
  });
}

function forDisplay(structured) {
  if (!Array.isArray(structured.elements)) return structured;
  const { elements, text: _text, ...rest } = structured;
  return { ...rest, element_count: elements.length };
}

function imageBytesOf(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const image = content.find((block) => block?.type === "image" && typeof block.data === "string");
  return image ? Uint8Array.from(Buffer.from(image.data, "base64")) : undefined;
}

function appStateOf(methodName, result) {
  const structured =
    result?.structuredContent && typeof result.structuredContent === "object"
      ? result.structuredContent
      : {};
  const merged = { ...structured };
  for (const text of textBlocks(result)) {
    const parsed = parseJsonRecord(text);
    if (!parsed) continue;
    for (const key of ["state_id", "app", "window", "elements", "text", "snapshot_mode", "base_state_id"]) {
      if (merged[key] === undefined && parsed[key] !== undefined) merged[key] = parsed[key];
    }
  }
  if (merged.text === undefined) {
    const tree = textBlocks(result).find((text) => !parseJsonRecord(text));
    if (tree) merged.text = tree;
  }
  const missing = [
    typeof merged.state_id !== "string" ? "state_id" : null,
    Array.isArray(merged.elements) ? null : "elements",
    merged.app ? null : "app",
    merged.window ? null : "window",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new ComputerUseError(
      `${methodName} returned no usable accessibility state: missing ${missing.join(", ")}. ` +
        "A hidden app with no open window can produce this, and re-observing will not change it. " +
        "Check listApps() for the app's state, or ask the user to open a window. " +
        "Do not infer a state_id from prose.",
      { code: "STRUCTURED_STATE_UNAVAILABLE", details: { method: methodName, missing } },
    );
  }
  return merged;
}

function advisoryTextOf(result, treeText) {
  const blocks = textBlocks(result).filter(
    (text) => text && text !== treeText && !parseJsonRecord(text) && !isFrameAuthorityText(text),
  );
  return blocks.length > 0 ? `\n${blocks.join("\n")}` : "";
}

// ─────────────────────────────────────────────────────────── Target

function createTarget(ctx, binding) {
  const { call, globals } = ctx;

  const observe = async (options, includeScreenshot, yieldsTree) => {
    const args = { app_ref: binding.appRef, include_screenshot: includeScreenshot };
    //
    //
    if (yieldsTree === true && binding.treeSeen !== true) args.disable_diffing = true;
    if (options?.disableDiffing === true) args.disable_diffing = true;
    if (yieldsTree !== true) args.tree_shown_to_model = false;
    const result = await call("get_app_state", args);
    assertOk("get_app_state", result);
    const state = appStateOf("get_app_state", result);
    binding.stateId = state.state_id;
    binding.treeSeen = yieldsTree === true;
    const frameId = frameIdOf(result);
    if (typeof frameId === "string") binding.frameId = frameId;
    return { state, result };
  };

  const act = async (methodName, args) => {
    const result = await call(methodName, args);
    assertOk(methodName, result);
    //
    //
  };

  return {
    async getAXState(options) {
      const { state, result } = await observe(options, false, true);
      const text = `${state.text}${advisoryTextOf(result, state.text)}`;
      emitText(globals, text, options);
      return text;
    },

    async getScreenshot(options) {
      const { state, result } = await observe(options, true, false);
      const bytes = imageBytesOf(result);
      if (!bytes) {
        throw new ComputerUseError(
          //
          `Screenshot unavailable for ${binding.label}` +
            (state.non_actionable_reason ? ` (${state.non_actionable_reason})` : "") +
            (state.screenshot_blank ? " (the captured raster was blank)" : "") +
            ". The accessibility tree still works on a hidden or unrendered window: use " +
            "getAXState() and act on element indices. Do not activate the app; ask the user " +
            "to unhide the window if pixels are genuinely required.",
          { code: "ELEMENT_UNAVAILABLE", details: { app: binding.label } },
        );
      }
      return bytes;
    },

    async getAXStateAndScreenshot(options) {
      const { state, result } = await observe(options, true, true);
      const screenshot = imageBytesOf(result);
      const note =
        screenshot || !state.non_actionable_reason
          ? ""
          : `\n[screenshot unavailable: ${state.non_actionable_reason}]` +
            " A hidden or minimized window produces this persistently, so re-observing will not" +
            " help. The accessibility tree above is complete — act on element indices. Do not" +
            " activate the app.";
      const text = `${state.text}${advisoryTextOf(result, state.text)}`;
      emitText(globals, `${text}${note}`, options);
      return screenshot ? { state: text, screenshot } : { state: text };
    },

    async paste(text, options) {
      if (typeof text !== "string") {
        throw new ComputerUseError("paste requires text", { code: "INTERNAL" });
      }
      await act("paste", {
        app_ref: binding.appRef,
        text,
        format: options?.format ?? "text",
      });
    },

    async click(target, options) {
      const bound = bindTarget(binding, target, "click");
      const button = options?.mouseButton ? MOUSE_BUTTONS[options.mouseButton] : "left";
      if (!button) {
        throw new ComputerUseError(
          `click mouseButton must be left, right or middle (got ${options.mouseButton})`,
          { code: "INTERNAL" },
        );
      }
      await act("left_click", {
        target: bound,
        app_ref: binding.appRef,
        mouse_button: button,
        click_count: options?.clickCount ?? 1,
        ...(options?.modifiers ? { modifiers: options.modifiers } : {}),
        ...(options?.strategy ? { strategy: options.strategy } : {}),
      });
    },

    async drag(from, to, options) {
      await act("left_click_drag", {
        from_target: bindTarget(binding, from, "drag from"),
        to: bindTarget(binding, to, "drag to"),
        app_ref: binding.appRef,
        ...(options?.modifiers ? { modifiers: options.modifiers } : {}),
      });
    },

    async pressKey(key, options) {
      if (typeof key !== "string" || !key.trim()) {
        throw new ComputerUseError("pressKey requires a key or chord", { code: "INTERNAL" });
      }
      await act("key", {
        text: normalizeKeyChord(key, ctx.platform),
        app_ref: binding.appRef,
        ...(options?.holdSeconds !== undefined ? { hold_seconds: options.holdSeconds } : {}),
        ...(options?.strategy ? { strategy: options.strategy } : {}),
      });
    },

    async scroll(target, direction, pages, options) {
      const dir = typeof direction === "string" ? direction.trim().toLowerCase() : "";
      if (!DIRECTIONS.has(dir)) {
        throw new ComputerUseError(
          `scroll direction must be up, down, left or right (got ${direction})`,
          { code: "INTERNAL" },
        );
      }
      await act("scroll", {
        target: bindTarget(binding, target, "scroll"),
        app_ref: binding.appRef,
        scroll_direction: LONG_DIRECTION[dir] ?? dir,
        scroll_amount: pages === undefined ? 1 : pages,
        ...(options?.strategy ? { strategy: options.strategy } : {}),
      });
    },

    async selectText(elementIndex, text, options) {
      const bound = bindTarget(binding, elementIndex, "selectText");
      const range = resolveTextRange(binding, elementIndex, text, options);
      await act("select_text", { target: bound, app_ref: binding.appRef, text_range: range });
    },

    async setValue(elementIndex, value) {
      if (typeof value !== "string") {
        throw new ComputerUseError("setValue requires a string value", { code: "INTERNAL" });
      }
      await act("set_value", {
        target: bindTarget(binding, elementIndex, "setValue"),
        app_ref: binding.appRef,
        value,
      });
    },

    async typeText(text) {
      if (typeof text !== "string") {
        throw new ComputerUseError("typeText requires text", { code: "INTERNAL" });
      }
      await act("type", { text, app_ref: binding.appRef });
    },

    async performSecondaryAction(elementIndex, action) {
      if (typeof action !== "string" || !action.trim()) {
        throw new ComputerUseError(
          "performSecondaryAction requires an action advertised by the element; do not guess one",
          { code: "ACTION_UNAVAILABLE" },
        );
      }
      await act("perform_action", {
        target: bindTarget(binding, elementIndex, "performSecondaryAction"),
        app_ref: binding.appRef,
        action,
      });
    },
  };
}

function resolveTextRange(binding, elementIndex, text, options) {
  if (text && typeof text === "object" && Number.isInteger(text.start)) {
    return [text.start, text.length ?? 0];
  }
  if (typeof text !== "string" || text.length === 0) {
    throw new ComputerUseError("selectText requires the text to locate", { code: "INTERNAL" });
  }
  const element = binding.elements?.[elementIndex];
  const value = typeof element?.value === "string" ? element.value : undefined;
  if (value === undefined) {
    throw new ComputerUseError(
      `selectText cannot locate text in element ${elementIndex}: the latest accessibility state exposed no value for it. Observe again, or use a range { start, length }.`,
      { code: "NOT_SELECTABLE", details: { elementIndex } },
    );
  }
  const needle = `${options?.prefix ?? ""}${text}${options?.suffix ?? ""}`;
  const hits = [];
  for (let at = value.indexOf(needle); at !== -1; at = value.indexOf(needle, at + 1)) {
    hits.push(at);
  }
  if (hits.length === 0) {
    throw new ComputerUseError(
      `selectText found no occurrence of the requested text in element ${elementIndex}`,
      { code: "NOT_SELECTABLE", details: { elementIndex } },
    );
  }
  if (hits.length > 1) {
    throw new ComputerUseError(
      `selectText matched ${hits.length} occurrences in element ${elementIndex}; disambiguate with prefix/suffix`,
      { code: "NOT_SELECTABLE", details: { elementIndex, matches: hits.length } },
    );
  }
  const start = hits[0] + (options?.prefix?.length ?? 0);
  const selectionType = options?.selectionType ?? "text";
  if (selectionType === "cursor_before") return [start, 0];
  if (selectionType === "cursor_after") return [start + text.length, 0];
  return [start, text.length];
}

const KEY_ALIASES = Object.freeze({
  return: "return", enter: "return", kp_enter: "return",
  control_l: "ctrl", control_r: "ctrl", control: "ctrl", ctrl: "ctrl",
  alt_l: "alt", alt_r: "alt", meta_l: "alt", alt: "alt",
  shift_l: "shift", shift_r: "shift", shift: "shift",
  escape: "esc", esc: "esc",
  prior: "pageup", next: "pagedown",
  period: ".", comma: ",", greater: ">", slash: "/", minus: "-", equal: "=",
});

function normalizeKeyChord(chord, platform) {
  return chord
    .split("+")
    .map((raw) => {
      const token = raw.trim();
      const lower = token.toLowerCase();
      if (lower === "super_l" || lower === "super_r" || lower === "super") {
        return platform === "darwin" ? "cmd" : platform === "win32" ? "win" : "super";
      }
      return KEY_ALIASES[lower] ?? token;
    })
    .filter(Boolean)
    .join("+");
}

export async function setupComputerUseRuntime({ globals }) {
  const bridge = globals[BRIDGE_SYMBOL];
  if (!bridge || typeof bridge !== "object" || typeof bridge.call !== "function") {
    throw new Error(
      "Computer Use runtime bridge is unavailable. Use Computer Use from a CodeFusion desktop or shared-host session.",
    );
  }
  bridge.assertAvailable?.();

  const platform = globals.process?.platform ?? process.platform;

  const call = async (methodName, args) => {
    for (let attempt = 0; ; attempt += 1) {
      bridge.assertAvailable?.();
      const result = await bridge.call(methodName, args ?? {});
      const notReady = notReadyEnvelopeOf(result);
      if (!notReady) {
        projectToHost(globals, result);
        return result;
      }
      if (notReady.retryable !== true || attempt >= NOT_READY_MAX_ATTEMPTS - 1) {
        throw new ComputerUseError(
          `${methodName}: ${notReady.message ?? "Computer Use is not ready."}`,
          {
            code: notReady.retryable === true ? "TIMEOUT" : "CONTROLLER_BUSY",
            details: {
              method: methodName,
              reasonCode: notReady.reasonCode,
              retryable: notReady.retryable === true,
              attempts: attempt + 1,
            },
          },
        );
      }
      await sleep(NOT_READY_BACKOFF_MS[Math.min(attempt, NOT_READY_BACKOFF_MS.length - 1)]);
    }
  };

  const ctx = { call, globals, platform };

  
  const createBinding = (label, appRef) => ({
    label,
    appRef,
    stateId: undefined,
    frameId: undefined,
    elements: undefined,
    treeSeen: false,
  });

  const bindApp = async (target, windowId) => {
    let objectRef;
    let label = typeof target === "string" ? target : "";
    if (target && typeof target === "object" && !Array.isArray(target)) {
      const direct = windowId === undefined ? { ...target } : { ...target, window_id: windowId };
      if (
        typeof direct.name !== "string" &&
        typeof direct.bundle_id !== "string" &&
        typeof direct.pid !== "number"
      ) {
        throw new ComputerUseError(
          "getApp needs an app display name, a bundle id, or {name|bundle_id|pid}",
          { code: "INVALID_APP" },
        );
      }
      objectRef = direct;
      label = String(direct.name ?? direct.bundle_id ?? direct.pid);
    } else if (typeof target !== "string" || !target.trim()) {
      throw new ComputerUseError(
        "getApp needs an app display name, a bundle id, or {name|bundle_id|pid}",
        { code: "INVALID_APP" },
      );
    }
    let appRef = objectRef ?? appRefFor(target, windowId);
    const binding = createBinding(label, appRef);
    const app = createTarget(ctx, binding);
    let result = await call("get_app_state", {
      app_ref: appRef,
      include_screenshot: false,
      disable_diffing: true,
      tree_shown_to_model: false,
    });
    if (isAppNotFound(result) && objectRef === undefined) {
      const alternate = alternateAppRef(target, windowId);
      if (alternate) {
        appRef = alternate;
        binding.appRef = alternate;
        result = await call("get_app_state", {
          app_ref: alternate,
          include_screenshot: false,
          disable_diffing: true,
          tree_shown_to_model: false,
        });
      }
    }
    assertOk("get_app_state", result);
    const state = appStateOf("get_app_state", result);
    binding.stateId = state.state_id;
    binding.elements = state.elements;
    //
    //   press_key_to_app: app_ref did not resolve to a unique live application
    //
    const resolvedPid = typeof state.app?.pid === "number" ? state.app.pid : undefined;
    const resolvedBundleId =
      typeof state.app?.bundle_id === "string" && state.app.bundle_id.trim()
        ? state.app.bundle_id
        : undefined;
    if (resolvedPid !== undefined || resolvedBundleId !== undefined) {
      const boundWindowId =
        typeof appRef?.window_id === "number" ? { window_id: appRef.window_id } : {};
      appRef = {
        ...(resolvedPid !== undefined ? { pid: resolvedPid } : {}),
        ...(resolvedBundleId !== undefined ? { bundle_id: resolvedBundleId } : {}),
        ...boundWindowId,
      };
      binding.appRef = appRef;
    }
    //
    const boundWindow = typeof appRef?.window_id === "number" ? appRef.window_id : windowId;
    if (boundWindow !== undefined && state.window?.window_id_fallback === true) {
      throw new ComputerUseError(
        `Window ${boundWindow} of ${label} could not be resolved; the Helper fell back to the frontmost window. Call agent.computerUse.computer.list_windows to pick a fresh window_id.`,
        { code: "STALE_STATE", details: { app: label, windowId: boundWindow } },
      );
    }
    //
    //
    //
    //
    Object.defineProperty(app, "elements", {
      enumerable: false,
      value: async () => {
        //
        const fresh = appStateOf(
          "get_app_state",
          await call("get_app_state", { app_ref: appRef, tree_shown_to_model: false }),
        );
        binding.stateId = fresh.state_id;
        binding.elements = fresh.elements;
        binding.treeSeen = false;
        return fresh.elements;
      },
    });
    return app;
  };

  const inventory = async (options) => {
    const result = await call("list_apps", {});
    assertOk("list_apps", result);
    const apps = [];
    for (const text of textBlocks(result)) {
      const parsed = parseJsonValue(text);
      if (Array.isArray(parsed?.apps)) apps.push(...parsed.apps);
      else if (Array.isArray(parsed)) apps.push(...parsed);
    }
    const state = { apps };
    emitText(globals, JSON.stringify(state, null, 2), options);
    return state;
  };

  //
  const unwrapEnvelope = (result) => {
    if (result === null || typeof result !== "object") return result;
    if (!Array.isArray(result.content)) return result;
    const textBlocks = result.content.filter(
      (block) => block && block.type === "text" && typeof block.text === "string",
    );
    if (textBlocks.length !== 1 || result.content.length !== 1) return result;
    const text = textBlocks[0].text;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  const computer = Object.create(null);
  Object.defineProperty(computer, "target", {
    enumerable: true,
    value: platform === "darwin" ? "mac" : platform === "win32" ? "windows" : "linux",
  });
  const excluded = new Set(PLATFORM_EXCLUDED_METHODS[platform] ?? []);
  for (const methodName of COMPUTER_METHOD_NAMES) {
    if (excluded.has(methodName)) continue;
    Object.defineProperty(computer, methodName, {
      enumerable: true,
      value: async (args = {}) => unwrapEnvelope(await call(methodName, args)),
    });
  }

  const cua = {
    async getState(options) {
      return await inventory(options);
    },
    async getApp(target) {
      return await bindApp(target);
    },
    async listApps(options) {
      return (await inventory(options)).apps;
    },
    computer: Object.freeze(computer),
    async requestAccess(capabilities) {
      const result = await call("request_access", capabilities ? { capabilities } : {});
      assertOk("request_access", result);
      const texts = textBlocks(result);
      return parseJsonRecord(texts[0]) ?? { ready: true };
    },
    async stop(reason) {
      const result = await call("stop_computer_control", reason ? { reason } : {});
      assertOk("stop_computer_control", result);
    },
  };
  Object.defineProperty(cua, "getWindow", {
    enumerable: false,
    value: async (target, windowId) => await bindApp(target, windowId),
  });

  const agent = (globals.agent ??= {});
  agent.computerUse = cua;

  const previousDocumentation = agent.documentation;
  const previousGet =
    previousDocumentation && typeof previousDocumentation.get === "function"
      ? previousDocumentation.get.bind(previousDocumentation)
      : undefined;
  agent.documentation = Object.freeze({
    get: async (name) => {
      if (name !== "computer-use") {
        if (previousGet) return await previousGet(name);
        throw new Error(`Unknown documentation entry: ${name}`);
      }
      if (typeof bridge.documentationRoot !== "string") {
        throw new Error("Computer Use documentation is unavailable");
      }
      return await readFile(join(bridge.documentationRoot, "computer-use.md"), "utf8");
    },
  });

  return cua;
}

export { COMPUTER_METHOD_NAMES, PLATFORM_EXCLUDED_METHODS, ComputerUseError, normalizeKeyChord };
