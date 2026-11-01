// Browser-owned DOM presentation only. This object grants no native bridge,
// storage, network, permissions, or cross-origin access. Every result returned
// to Rust is untrusted document data and requires native document attribution.
(() => {
  "use strict";
  const key = "__zephium_content_style_v1__";
  if (Object.prototype.hasOwnProperty.call(globalThis, key)) return;
  const apply = Reflect.apply;
  const create = Object.create;
  const stringify = JSON.stringify;
  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "adoptedStyleSheets");
  if (!descriptor?.get || !descriptor?.set || typeof CSSStyleSheet !== "function") return;
  const replace = CSSStyleSheet.prototype.replaceSync;
  const getSheets = () => apply(descriptor.get, document, []);
  const setSheets = sheets => apply(descriptor.set, document, [sheets]);
  const queryAll = Document.prototype.querySelectorAll;
  const focus = HTMLElement.prototype.focus;
  const random = new Uint32Array(4);
  crypto.getRandomValues(random);
  const token = Array.from(random, n => n.toString(16).padStart(8, "0")).join("");
  const slots = new Map();
  const inlineOverrides = new Map();
  const allowed = new Set(["subscription", "personal", "preview", "page-style"]);
  // The shared picker look; absent only where this file runs on its own.
  const kit = typeof pickerKit === "object" ? pickerKit : null;
  let picker = null;
  // Elements hidden the moment they are picked, until the saved personal
  // sheet (or its absence after a failed save) takes over.
  const picked = [];
  let generic = null;

  function stopGeneric() {
    if (!generic) return;
    generic.observer.disconnect();
    if (generic.idle !== null) {
      if (globalThis.cancelIdleCallback) cancelIdleCallback(generic.idle);
      else clearTimeout(generic.idle);
    }
    generic.idle = null;
    generic.roots.clear(); generic.walker = null; generic.cursor = null;
    if (generic.waiter) { const done = generic.waiter; generic.waiter = null; done(null); }
  }
  function addGenericToken(state, key) {
    if (state.remote) {
      // The immutable host index has ASCII class/id keys. Escaped and Unicode
      // selectors already belong to the unconditional native-supplied CSS.
      if (!/^[.#][A-Za-z0-9_-]{1,4096}$/.test(key) || state.tokens.has(key) ||
          state.pending.has(key) || state.batch?.tokens.includes(key)) return true;
      if (state.pending.size >= 256 || state.pendingBytes + key.length > 65536) {
        state.blocked = true; return false;
      }
      state.pending.add(key); state.pendingBytes += key.length; return true;
    }
    const selectors = state.index.get(key);
    if (!selectors) return true;
    for (const selector of selectors) {
      if (state.seen.has(selector) || state.exceptions.has(selector)) continue;
      if (state.seen.size >= 2048) return true;
      state.seen.add(selector);
      try { state.sheet.insertRule(`${selector}{display:none!important}`, state.sheet.cssRules.length); } catch (_) {}
      if (state.seen.size === 2048) {
        // No further rule can be admitted in this document/policy. Stop
        // observing rather than scanning every later mutation forever,
        // and release the now-unused per-document lookup payload.
        stopGeneric(); state.index.clear(); state.exceptions.clear();
        return true;
      }
    }
    return true;
  }
  function settleGeneric(state) {
    if (!state.remote || document.hidden || !state.waiter || (!state.batch && !state.pending.size)) return;
    const done = state.waiter; state.waiter = null;
    if (!state.batch) {
      if (state.serial >= Number.MAX_SAFE_INTEGER) { done(null); stopGeneric(); return; }
      state.batch = { serial: ++state.serial, tokens: [...state.pending] };
      state.pending.clear(); state.pendingBytes = 0;
    }
    state.blocked = false;
    done(state.batch);
  }
  function pullGeneric(expectedToken, expectedUrl, fingerprint) {
    const state = generic;
    if (!matches(expectedToken, expectedUrl) || !state?.remote ||
        state.fingerprint !== fingerprint || state.seen.size >= 2048 || state.waiter) return null;
    return new Promise(resolve => {
      state.waiter = batch => {
        if (!batch || generic !== state || document.hidden || !matches(expectedToken, expectedUrl)) {
          resolve(null); return;
        }
        const reply = create(null);
        reply.token = token; reply.url = expectedUrl; reply.subscription = fingerprint;
        reply.serial = batch.serial; reply.tokens = batch.tokens;
        resolve(stringify(reply));
      };
      settleGeneric(state); scheduleGeneric();
    });
  }
  function applyGeneric(expectedToken, expectedUrl, fingerprint, serial, selectors) {
    const state = generic;
    if (!matches(expectedToken, expectedUrl) || !state?.remote || document.hidden ||
        state.fingerprint !== fingerprint || state.batch?.serial !== serial ||
        !Array.isArray(selectors) || selectors.length > 2048 ||
        selectors.some(s => typeof s !== "string" || s.length > 8192) ||
        selectors.reduce((n,s) => n+s.length, 0) > 1048576) return false;
    if (!getSheets().includes(state.sheet)) return false;
    for (const selector of selectors) {
      if (state.seen.has(selector)) continue;
      if (state.seen.size >= 2048) break;
      state.seen.add(selector);
      try { state.sheet.insertRule(`${selector}{display:none!important}`, state.sheet.cssRules.length); } catch (_) {}
    }
    for (const key of state.batch.tokens) {
      if (state.tokens.has(key)) continue;
      while (state.tokens.size >= 4096 || state.tokenBytes + key.length > 131072) {
        const oldest = state.tokens.values().next().value;
        if (oldest === undefined) break;
        state.tokens.delete(oldest); state.tokenBytes -= oldest.length;
      }
      state.tokens.add(key); state.tokenBytes += key.length;
    }
    state.batch = null; state.blocked = false;
    if (state.seen.size >= 2048) stopGeneric();
    else scheduleGeneric();
    return true;
  }
  function scheduleGeneric() {
    const state = generic;
    if (!state || state.seen.size >= 2048 || document.hidden || state.blocked || state.idle !== null || (!state.walker && !state.roots.size)) return;
    const callback = deadline => {
      state.idle = null;
      if (generic !== state || document.hidden) return;
      const end = performance.now() + 2;
      let visited = 0;
      while (visited < 200 && performance.now() < end && (!deadline || deadline.timeRemaining() > 1 || deadline.didTimeout)) {
        if (!state.walker) {
          const entry = state.roots.entries().next().value;
          if (!entry) break;
          const [root, subtree] = entry;
          state.roots.delete(root);
          if (!root.isConnected) continue;
          // A queued subtree covers its queued descendants at this instant.
          // Keep mutations arriving during the walk queued separately: their
          // nodes may already have been visited before a later attribute edit.
          if (subtree && root.firstElementChild) for (const pending of state.roots.keys()) {
            if (root.contains(pending)) state.roots.delete(pending);
          }
          state.walker = subtree ? document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT) : { root, currentNode: root, nextNode: () => null };
          state.first = true;
        }
        if (!state.cursor) {
          const node = state.first ? state.walker.currentNode : state.walker.nextNode();
          state.first = false;
          if (!node || !state.walker.root.isConnected) { state.walker = null; continue; }
          state.cursor = { node, id: false, index: 0 };
        }
        const cursor = state.cursor, node = cursor.node;
        if (!node.isConnected) {
          // A held token batch can pause the walker while the page removes
          // its current node. TreeWalker cannot advance out of that detached
          // subtree, so resume with a bounded rescan of the live document.
          state.cursor = null; state.walker = null;
          if (document.documentElement) state.roots.set(document.documentElement, true);
          continue;
        }
        if (!cursor.id) {
          if (node.id && node.id.length <= 4096 && !addGenericToken(state, `#${node.id}`)) break;
          cursor.id = true;
        }
        while (cursor.index < Math.min(node.classList.length, 128)) {
          const name = node.classList[cursor.index];
          if (name.length <= 4096 && !addGenericToken(state, `.${name}`)) break;
          cursor.index++;
        }
        if (state.blocked) break;
        state.cursor = null; visited++;
      }
      settleGeneric(state); scheduleGeneric();
    };
    state.idle = globalThis.requestIdleCallback
      ? requestIdleCallback(callback, { timeout: 200 })
      : setTimeout(() => callback(null), 32);
  }
  function observeGeneric() {
    if (!generic || generic.seen.size >= 2048 || document.hidden) return;
    generic.observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["id", "class"] });
    if (document.documentElement) generic.roots.set(document.documentElement, true);
    scheduleGeneric();
  }
  function subscriptionFingerprint() {
    const old = slots.get("subscription");
    if (!old) return null;
    return getSheets().includes(old.sheet) || (!generic && old.sheet.cssRules.length === 0) ? old.fingerprint : null;
  }
  function reuseSubscription(expectedToken, expectedUrl, generation, fingerprint) {
    if (!matches(expectedToken, expectedUrl) || !/^[0-9a-f]{16}$/.test(generation) ||
        subscriptionFingerprint() !== fingerprint) return false;
    const old = slots.get("subscription");
    if (generation < old.generation) return false;
    old.generation = generation;
    if (generic?.remote && generic.waiter) { const done = generic.waiter; generic.waiter = null; done(null); }
    return true;
  }
  function setSubscription(expectedToken, expectedUrl, generation, fingerprint, css, indexJson, exceptionJson) {
    const remote = typeof indexJson === "boolean";
    if (!matches(expectedToken, expectedUrl) || (!remote && (typeof indexJson !== "string" || indexJson.length > 1048576)) ||
        typeof exceptionJson !== "string" || exceptionJson.length > 1048576) return false;
    const old = slots.get("subscription");
    if (old && generation < old.generation) return false;
    if (old && generation === old.generation && fingerprint !== old.fingerprint) return false;
    if (old?.fingerprint === fingerprint && (getSheets().includes(old.sheet) || (!css && indexJson === "[]")) && (!generic || generic.fingerprint === fingerprint)) {
      old.generation = generation; return true;
    }
    try {
      const entries = remote ? [] : JSON.parse(indexJson), exceptions = remote ? [] : JSON.parse(exceptionJson);
      if (!Array.isArray(entries) || entries.length > 50000 || !Array.isArray(exceptions) || exceptions.length > 50000) return false;
      stopGeneric(); generic = null;
      if (!setStyle("subscription", expectedToken, expectedUrl, generation, fingerprint, css)) return false;
      if (remote ? !indexJson : !entries.length) return true;
      const sheet = slots.get("subscription").sheet;
      if (!getSheets().includes(sheet)) setSheets([...getSheets(), sheet]);
      const state = { fingerprint, sheet, remote, index: remote ? null : new Map(entries), exceptions: new Set(exceptions), seen: new Set(), roots: new Map(), walker: null, cursor: null, first: false, idle: null, observer: null,
        tokens: new Set(), tokenBytes: 0, pending: new Set(), pendingBytes: 0, batch: null, serial: 0, waiter: null, blocked: false };
      state.observer = new MutationObserver(records => {
        if (generic !== state || document.hidden) return;
        const whole = document.documentElement;
        let admitted = 0, overflow = false;
        scan: for (const record of records) {
          if (whole && state.roots.get(whole) === true) break;
          if (++admitted > 256 || state.roots.size >= 256) { overflow = true; break; }
          if (record.type === "attributes") {
            if (!state.roots.has(record.target)) state.roots.set(record.target, false);
          }
          else for (const node of record.addedNodes) {
            if (++admitted > 256 || state.roots.size >= 256) { overflow = true; break scan; }
            if (node.nodeType === Node.ELEMENT_NODE) state.roots.set(node, true);
          }
        }
        // Too many changes to track one by one (infinite scroll): one idle-
        // sliced walk of the whole document covers them all instead.
        if (overflow) {
          state.roots.clear();
          if (whole) state.roots.set(whole, true);
        }
        scheduleGeneric();
      });
      generic = state; observeGeneric(); return true;
    } catch (_) { stopGeneric(); generic = null; return false; }
  }
  document.addEventListener("visibilitychange", () => document.hidden ? stopGeneric() : observeGeneric());
  globalThis.addEventListener("pagehide", stopGeneric);
  globalThis.addEventListener("pageshow", event => { if (event.isTrusted && event.persisted) observeGeneric(); });

  function matches(expectedToken, expectedUrl) {
    return expectedToken === token && expectedUrl === location.href;
  }

  function setStyle(slot, expectedToken, expectedUrl, generation, fingerprint, css) {
    if (!allowed.has(slot) || !matches(expectedToken, expectedUrl) ||
        !/^[0-9a-f]{16}$/.test(generation) || !/^[0-9a-f]{64}$/.test(fingerprint) ||
        typeof css !== "string" || css.length > 1048576) return false;
    const old = slots.get(slot);
    if (old && generation < old.generation) return false;
    if (old && generation === old.generation && fingerprint !== old.fingerprint) return false;
    try {
      if (old && old.fingerprint === fingerprint && getSheets().includes(old.sheet)) {
        old.generation = generation;
        return true;
      }
      const sheet = new CSSStyleSheet();
      apply(replace, sheet, [css]);
      const sheets = getSheets().filter(s => !old || s !== old.sheet);
      if (css) sheets.push(sheet);
      setSheets(sheets);
      // Keep only the native-supplied identity, not a second copy of the CSS
      // text alongside the browser's parsed stylesheet in every document.
      slots.set(slot, { sheet, fingerprint, generation });
      if (slot === "personal") { clearStyle("preview"); restorePicked(); enforceInline(slot); }
      if (slot === "preview") enforceInline(slot);
      return true;
    } catch (_) { return false; }
  }

  function restoreInline(slot) {
    const entries = inlineOverrides.get(slot) ?? [];
    inlineOverrides.delete(slot);
    for (const entry of entries) {
      const element = entry.element.deref();
      if (!element || element.style.getPropertyValue("display") !== "none" || element.style.getPropertyPriority("display") !== "important") continue;
      if (entry.value) element.style.setProperty("display", entry.value, entry.priority);
      else element.style.removeProperty("display");
    }
  }

  function hidePicked(element) {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return;
    picked.push({ element: new WeakRef(element), value: element.style.getPropertyValue("display"), priority: element.style.getPropertyPriority("display") });
    element.style.setProperty("display", "none", "important");
  }

  function restorePicked() {
    for (const entry of picked.splice(0)) {
      const element = entry.element.deref();
      if (!element || element.style.getPropertyValue("display") !== "none") continue;
      if (entry.value) element.style.setProperty("display", entry.value, entry.priority);
      else element.style.removeProperty("display");
    }
  }

  function enforceInline(slot) {
    // Personal edits may target inline !important declarations. Reconcile a
    // bounded set only on an explicit edit/preview or initial DOM readiness;
    // subscription CSS never causes a document scan or repair observer.
    restoreInline(slot);
    const owned = slots.get(slot);
    if (!owned) return;
    const entries = [];
    const seen = new Set();
    try {
      for (const rule of owned.sheet.cssRules) {
        if (typeof rule.selectorText !== "string") continue;
        for (const element of apply(queryAll, document, [rule.selectorText])) {
          if (seen.has(element)) continue;
          seen.add(element);
          if (seen.size > 1000) break;
          if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) continue;
          if (getComputedStyle(element).display === "none") continue;
          const value = element.style.getPropertyValue("display");
          if (value.length > 1024) continue;
          entries.push({ element: new WeakRef(element), value, priority: element.style.getPropertyPriority("display") });
          element.style.setProperty("display", "none", "important");
        }
        if (seen.size > 1000) break;
      }
    } catch (_) {}
    inlineOverrides.set(slot, entries);
  }

  function clearStyle(slot) {
    restoreInline(slot);
    const old = slots.get(slot);
    if (!old) return;
    try { setSheets(getSheets().filter(s => s !== old.sheet)); } catch (_) {}
    slots.delete(slot);
  }

  function stopPicker() {
    if (!picker) return;
    const current = picker;
    picker = null;
    clearTimeout(current.expiry);
    current.ui.close();
    clearStyle("preview");
    enforceInline("personal");
    if (current.previousFocus instanceof HTMLElement && current.previousFocus.isConnected) {
      try { apply(focus, current.previousFocus, [{ preventScroll: true }]); } catch (_) {}
    }
  }

  function startPicker(expectedToken, expectedUrl, session) {
    if (!matches(expectedToken, expectedUrl) || !/^[0-9a-f]{16}$/.test(session) || !document.documentElement || !kit) return false;
    stopPicker();
    try {
      const bar = [["span", "Click to hide"], ["span", "·"], ["kbd", "↑"], ["kbd", "↓"], ["span", "wider or narrower"], ["span", "·"], ["kbd", "esc"], ["span", "done"]];
      const ui = kit.session(bar, kit.describe, false);
      if (!ui) return false;
      const cover = ui.cover;
      picker = { ui, cover, session, selected: null, selectedElement: null, previousFocus: document.activeElement, choose: null, key: null };
      cover.tabIndex = -1;
      cover.setAttribute("aria-label", "Hide elements. Click an element to hide it; press Escape when done.");
      apply(focus, cover, [{ preventScroll: true }]);
      ui.show();
      const current = picker;
      const expire = () => {
        clearTimeout(current.expiry);
        current.expiry = setTimeout(() => { if (picker === current) stopPicker(); }, 120000);
      };
      expire();
      current.key = event => { if (ui.key(event)) expire(); };
      // One pick waits for its save; the page never gets the click either way.
      current.choose = event => {
        if (!event.isTrusted || picker !== current || current.selected) return;
        const target = ui.target(event);
        const selection = target ? kit.candidate(target) : null;
        if (!selection) return;
        expire();
        current.selected = selection;
        current.selectedElement = new WeakRef(target);
        hidePicked(target);
        ui.reset();
      };
      globalThis.addEventListener("pagehide", stopPicker, { signal: ui.signal, once: true });
      return true;
    } catch (_) { stopPicker(); return false; }
  }

  document.addEventListener("DOMContentLoaded", () => enforceInline("personal"), { once: true });

  // Register before page scripts so capture listeners cannot turn selecting
  // an element into a page click. These guards are dormant when the picker is
  // closed; highlighting/pointer work remains strictly session-owned.
  for (const kind of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "auxclick", "contextmenu", "keydown"]) {
    globalThis.addEventListener(kind, event => {
      if (!picker) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (kind === "keydown" && event.key === "Escape") stopPicker();
      else if (kind === "keydown") picker.key?.(event);
      else if (kind === "click") picker.choose?.(event);
    }, { capture: true, passive: false });
  }

  Object.defineProperty(globalThis, key, { value: Object.freeze({
    version: 1,
    inspect: () => ({ token, url: location.href }),
    inspectEncoded: () => {
      if (location.href.length > 32768) return null;
      const result = create(null); result.token = token; result.url = location.href;
      result.subscription = subscriptionFingerprint();
      return stringify(result);
    },
    subscription: setSubscription,
    reuseSubscription,
    pullGeneric,
    applyGeneric,
    apply: setStyle,
    startPicker,
    beginEncoded: session => {
      const result = create(null);
      result.token = token; result.url = location.href;
      result.active = startPicker(token, location.href, session);
      return stringify(result);
    },
    selection: (expectedToken, expectedUrl, session) => matches(expectedToken, expectedUrl) && picker?.session === session ? picker.selected : null,
    pickerEncoded: (expectedToken, expectedUrl, session) => {
      const result = create(null);
      result.active = matches(expectedToken, expectedUrl) && picker?.session === session && picker.cover.isConnected;
      result.selection = result.active && picker.selectedElement?.deref()?.isConnected ? picker.selected : null;
      return stringify(result);
    },
    preview: (expectedToken, expectedUrl, session, enabled) => {
      if (!matches(expectedToken, expectedUrl) || picker?.session !== session || !picker.selected) return false;
      if (!enabled) { clearStyle("preview"); return true; }
      return setStyle("preview", expectedToken, expectedUrl, session, session.padStart(64, "0"), `${picker.selected.selector}{display:none!important}`);
    },
    stopPicker: (expectedToken, expectedUrl) => {
      if (!matches(expectedToken, expectedUrl)) return false;
      stopPicker(); return true;
    }
  }), writable: false, configurable: false });
})();
