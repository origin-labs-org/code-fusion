// One element picker for the whole app: the hover box with its label chip and
// size, the walk to a parent and back, the readable name of an element and the
// selector a pick yields. The blocker's page-world picker and the assistant's private-
// world one both include it; it keeps no state between sessions.
const pickerKit = (() => {
  "use strict";
  const apply = Reflect.apply, create = Object.create;
  const createNode = Document.prototype.createElement;
  const queryAll = Document.prototype.querySelectorAll;
  const fromPoint = Document.prototype.elementFromPoint;
  const replace = typeof CSSStyleSheet === "function" ? CSSStyleSheet.prototype.replaceSync : null;

  function make(tag, className, parent) {
    const element = apply(createNode, document, [tag]);
    if (className) element.className = className;
    if (parent) parent.append(element);
    return element;
  }

  function cssString(value) {
    return String(value).replace(/[\0-\x1f\x7f"\\]/g, c => "\\" + c.charCodeAt(0).toString(16) + " ");
  }

  const NAMES = { iframe: "Embedded content", img: "Image", picture: "Image", video: "Video", audio: "Audio player", aside: "Sidebar", nav: "Navigation", header: "Header", footer: "Footer", form: "Form", dialog: "Dialog", button: "Button", a: "Link", ul: "List", ol: "List", table: "Table", svg: "Graphic", canvas: "Graphic" };
  // A class or id read as words when it reads like some ("promo-banner" is
  // "promo banner"); generated and layout names read as nothing.
  function words(value) {
    const text = String(value || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim().toLowerCase();
    return /^[a-z][a-z ]{2,39}$/.test(text) && !/\b(css|jsx|sc|col|row|flex|grid|wrapper|container|inner|outer)\b/.test(text) ? text : "";
  }
  const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
  // A readable name for the hide list: its words, else the element's kind.
  function describe(element) {
    const found = words(element.getAttribute("id")) || Array.from(element.classList).map(words).find(Boolean) || "";
    return capital(found || NAMES[element.localName] || "Section");
  }

  function candidate(element) {
    if (!(element instanceof Element) || element === document.documentElement || element === document.body) return null;
    let selector = "";
    let positional = false;
    const id = element.getAttribute("id");
    if (id && id.length <= 128) selector = `[id="${cssString(id)}"]`;
    else {
      const classes = Array.from(element.classList).filter(c => c.length <= 80 && !/^(css|jsx|sc)-/.test(c)).slice(0, 2);
      if (classes.length) selector = classes.map(c => `[class~="${cssString(c)}"]`).join("");
    }
    // A bounded ancestor path is the fallback, with its instability exposed to
    // the UI. Never keep a DOM snapshot, arbitrary element text, or form values.
    if (!selector) {
      positional = true;
      const path = [];
      let node = element;
      for (let depth = 0; depth < 8 && node && node !== document.body; depth++, node = node.parentElement) {
        const name = node.localName;
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) return null;
        let index = 1;
        let previous = node.previousElementSibling;
        while (previous && index <= 10000) {
          if (previous.localName === name) index++;
          previous = previous.previousElementSibling;
        }
        if (index > 10000) return null;
        path.unshift(`${name}:nth-of-type(${index})`);
      }
      selector = path.join(" > ");
    }
    if (!selector || selector.length > 2048) return null;
    try {
      const count = apply(queryAll, document, [selector]).length;
      if (count === 0 || count > 100) return null;
      const label = describe(element);
      const result = create(null);
      result.selector = selector; result.label = Array.from(label).slice(0, 64).join("");
      result.count = count; result.positional = positional;
      return result;
    } catch (_) { return null; }
  }

  const STYLE = `
    :host { all: initial; }
    .box { position: fixed; pointer-events: none; box-sizing: border-box; display: none;
      border: 1.5px solid rgb(64 132 255); border-radius: 4px; background: rgb(64 132 255 / 16%);
      box-shadow: 0 0 0 1px rgb(255 255 255 / 55%); transition: left 60ms, top 60ms, width 60ms, height 60ms; }
    .chip { position: fixed; pointer-events: none; display: none; max-width: 320px; overflow: hidden;
      padding: 3px 7px; border-radius: 6px; background: #1c1c1f; color: #ededf0; white-space: nowrap;
      text-overflow: ellipsis; font: 500 11px/16px -apple-system, "Segoe UI", system-ui, sans-serif; }
    .chip span { color: #8e8e96; }
    .bar { position: fixed; left: 50%; bottom: 20px; translate: -50% 0; display: flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: 12px; background: #1c1c1f; color: #ededf0; pointer-events: none;
      box-shadow: 0 0 0 0.5px rgb(255 255 255 / 12%), 0 8px 24px rgb(0 0 0 / 35%);
      font: 450 12.5px/18px -apple-system, "Segoe UI", system-ui, sans-serif; white-space: nowrap;
      animation: rise 180ms cubic-bezier(.2,.8,.2,1) both; }
    .bar kbd { font: inherit; padding: 0 5px; border-radius: 4px; background: rgb(255 255 255 / 10%); color: #b4b4bc; }
    .muted { color: #8e8e96; }
    @keyframes rise { from { opacity: 0; translate: -50% 6px; } }
    @media (prefers-reduced-motion: reduce) { .box { transition: none; } .bar { animation: none; } }
  `;
  const COVER = "position:fixed;inset:0;margin:0;width:100%;height:100%;padding:0;border:0;background:transparent;z-index:2147483647;cursor:crosshair;overflow:visible";

  // A picking session's cover: hover box, chip and hint bar in a closed
  // shadow root. `bar` lists [tag, text] parts, the first one bright;
  // `label` names the hovered element. The caller shows it and owns what
  // a pick does.
  function session(bar, label, reduced) {
    if (!replace || !document.documentElement) return null;
    const cover = make("div");
    cover.popover = "manual";
    cover.style.cssText = COVER;
    const shadow = cover.attachShadow({ mode: "closed" });
    // Constructed sheets are exempt from the page's style-src policy.
    const sheet = new CSSStyleSheet();
    apply(replace, sheet, [reduced ? STYLE + ".box{transition:none}.bar{animation:none}" : STYLE]);
    shadow.adoptedStyleSheets = [sheet];
    const box = make("div", "box"), chip = make("div", "chip"), hint = make("div", "bar");
    // Built from nodes: pages enforcing Trusted Types reject innerHTML.
    bar.forEach(([tag, text], index) => {
      const part = make(tag, tag === "span" && index > 0 ? "muted" : "", hint);
      part.textContent = text;
    });
    shadow.append(box, chip, hint);
    document.documentElement.append(cover);
    const abort = new AbortController();
    const ui = { cover, signal: abort.signal, hovered: null, trail: [], frame: 0, point: null, moved: null };
    const targetAt = (x, y) => {
      cover.style.pointerEvents = "none";
      const target = apply(fromPoint, document, [x, y]);
      cover.style.pointerEvents = "auto";
      return target;
    };
    const eligible = target => target instanceof Element && target !== cover && target !== document.documentElement && target !== document.body;
    function highlight(target) {
      if (!eligible(target)) {
        box.style.display = "none"; chip.style.display = "none";
        return;
      }
      const rect = target.getBoundingClientRect();
      box.style.display = "block";
      box.style.left = `${rect.left}px`; box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`; box.style.height = `${rect.height}px`;
      chip.textContent = label(target);
      const size = make("span");
      size.textContent = ` \u00b7 ${Math.round(rect.width)} \u00d7 ${Math.round(rect.height)}`;
      chip.append(size);
      chip.style.display = "block";
      const above = rect.top - 24;
      chip.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - chip.offsetWidth - 4))}px`;
      chip.style.top = `${above >= 4 ? above : Math.min(rect.bottom + 4, innerHeight - 24)}px`;
    }
    cover.addEventListener("pointermove", event => {
      if (!event.isTrusted) return;
      ui.point = [event.clientX, event.clientY];
      if (ui.frame) return;
      ui.frame = requestAnimationFrame(() => {
        ui.frame = 0;
        if (!cover.isConnected) return;
        ui.hovered = targetAt(...ui.point);
        ui.trail = [];
        highlight(ui.hovered);
        if (ui.moved) ui.moved();
      });
    }, { signal: abort.signal, passive: true });
    // Arrow up widens to the parent, arrow down narrows back.
    ui.key = event => {
      // A key can come before the frame that follows the pointer.
      if (!ui.hovered && ui.point && !ui.trail.length) ui.hovered = targetAt(...ui.point);
      const hovered = ui.hovered;
      if (event.key === "ArrowUp" && eligible(hovered?.parentElement)) {
        ui.trail.push(hovered);
        ui.hovered = hovered.parentElement;
      } else if (event.key === "ArrowDown" && ui.trail.length) {
        ui.hovered = ui.trail.pop();
      } else return false;
      highlight(ui.hovered);
      return true;
    };
    ui.target = event => {
      const target = ui.hovered && ui.hovered.isConnected ? ui.hovered : targetAt(event.clientX, event.clientY);
      return eligible(target) ? target : null;
    };
    ui.reset = () => { ui.hovered = null; ui.trail = []; highlight(null); };
    ui.show = () => { if (typeof cover.showPopover === "function") cover.showPopover(); };
    ui.close = () => {
      abort.abort();
      if (ui.frame) cancelAnimationFrame(ui.frame);
      cover.remove();
    };
    return ui;
  }

  // A layer for drawings over the page: one host in the top layer holding a
  // closed shadow root, positioned against the initial containing block so
  // what it draws scrolls with the document by itself.
  const LAYER = "all:initial!important;display:block!important;position:absolute!important;inset:0 auto auto 0!important;" +
    "width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:visible!important;" +
    "background:transparent!important;pointer-events:none!important;visibility:visible!important;opacity:1!important;" +
    "transform:none!important;filter:none!important;contain:none!important;z-index:2147483647!important";
  function layer(css) {
    if (!replace || !document.documentElement) return null;
    const host = make("x-" + Math.random().toString(36).slice(2, 10));
    host.popover = "manual";
    host.style.cssText = LAYER;
    const shadow = host.attachShadow({ mode: "closed" });
    const sheet = new CSSStyleSheet();
    apply(replace, sheet, [css]);
    shadow.adoptedStyleSheets = [sheet];
    document.documentElement.append(host);
    try { if (typeof host.showPopover === "function") host.showPopover(); } catch (_) {}
    return { host, shadow };
  }

  return Object.freeze({ make, words, capital, describe, candidate, session, layer, NAMES });
})();
