// Fixed Ask panel recipes for the private world: the selected text, a quote
// scrolled to and marked, the page's outline for a style turn, numbered marks
// around items, and the person's pick of an element. Reached only through
// closed `Q1:` invocations; every page string is data.
(() => {
  "use strict";
  const NAME = "__zephiumPageAssistV1";
  if (Object.hasOwn(globalThis, NAME)) return;
  const doc = document;
  const apply = Reflect.apply, parse = JSON.parse, stringify = JSON.stringify;
  const style = getComputedStyle, now = () => performance.now();
  const rectOf = Element.prototype.getBoundingClientRect;
  const query = Document.prototype.querySelectorAll, queryIn = Element.prototype.querySelectorAll;
  const MAX_SELECTION = 4096, MAX_QUOTE = 2048, MAX_HAY = 2000000, MAX_TEXT_NODES = 100000;
  const MAX_NODES = 48, MAX_SCAN = 3000, MAX_OUTLINE_BYTES = 24 * 1024;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "INPUT", "SELECT", "OPTION", "SVG", "CANVAS"]);
  const TEXT_TYPES = new Set(["", "text", "search", "url", "email"]);
  const SECRET_HINT = /(?:pass|pwd|otp|one-?time|pin|cvv|cvc|csc|card|ccnum|cc-|security.?code|verification)/i;

  const lower = (value) => String(value || "").toLowerCase();
  // Exactly JavaScript's \s, without a regular expression per character.
  const space = (code) => code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f ||
    code === 0x205f || code === 0x3000 || code === 0xfeff;
  const attribute = (element, name) => {
    const value = element.getAttribute(name);
    return typeof value === "string" ? value.slice(0, 256) : "";
  };

  function protectedField(element) {
    if (lower(element.type) === "password") return true;
    const auto = lower(attribute(element, "autocomplete"));
    if (auto.includes("cc-") || auto.includes("one-time-code") || auto.includes("password")) return true;
    const hints = [attribute(element, "name"), element.id || "", attribute(element, "aria-label"), attribute(element, "placeholder")].join(" ");
    return SECRET_HINT.test(hints) || attribute(element, "maxlength") === "1";
  }

  function selection() {
    let text = "";
    const active = doc.activeElement;
    const tag = active && active.tagName;
    if (tag === "TEXTAREA" || (tag === "INPUT" && TEXT_TYPES.has(lower(active.type)))) {
      if (protectedField(active)) return "N";
      const start = active.selectionStart, end = active.selectionEnd;
      if (typeof start === "number" && typeof end === "number" && end > start) {
        text = String(active.value).slice(start, Math.min(end, start + MAX_SELECTION));
      }
    }
    if (!text) {
      const current = getSelection();
      if (current && !current.isCollapsed && current.rangeCount > 0) text = String(current).slice(0, MAX_SELECTION * 2);
    }
    text = text.replace(/\s+/gu, " ").trim().slice(0, MAX_SELECTION);
    return text ? "T:" + text : "N";
  }

  // Page text as one string with runs of white space collapsed, and where
  // each text node starts in it, so a match maps back to a DOM range.
  function textIndex(root) {
    const segments = [], parts = [];
    let length = 0, gap = true, nodes = 0;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        return parent && !SKIP.has(parent.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (++nodes > MAX_TEXT_NODES || length > MAX_HAY) break;
      const data = node.data;
      let out = "";
      const startGap = gap;
      for (let index = 0; index < data.length; index += 1) {
        if (space(data.charCodeAt(index))) {
          if (!gap) { out += " "; gap = true; }
        } else {
          out += data[index];
          gap = false;
        }
      }
      if (out.length === 0) continue;
      segments.push({ start: length, node, gap: startGap });
      parts.push(out);
      length += out.length;
    }
    return { hay: parts.join(""), segments };
  }

  function locate(index, position, end) {
    const segments = index.segments;
    let low = 0, high = segments.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (segments[middle].start <= position - (end ? 1 : 0)) low = middle; else high = middle - 1;
    }
    const segment = segments[low];
    if (!segment) return null;
    const data = segment.node.data;
    let collapsed = segment.start, gap = segment.gap;
    for (let raw = 0; raw < data.length; raw += 1) {
      const white = space(data.charCodeAt(raw));
      if (white && gap) continue;
      if (!end && collapsed === position) return [segment.node, raw];
      collapsed += 1;
      gap = white;
      if (end && collapsed === position) return [segment.node, raw + 1];
    }
    return end ? [segment.node, data.length] : null;
  }

  function find(index, quote) {
    const needle = quote.replace(/\s+/gu, " ").trim();
    if (needle.length < 2) return null;
    let at = index.hay.indexOf(needle), size = needle.length;
    if (at < 0) at = lower(index.hay).indexOf(lower(needle));
    if (at < 0 && needle.length > 120) {
      const head = needle.slice(0, 120);
      at = index.hay.indexOf(head);
      size = head.length;
    }
    if (at < 0) return null;
    const start = locate(index, at, false), end = locate(index, at + size, true);
    if (!start || !end) return null;
    const range = doc.createRange();
    range.setStart(start[0], start[1]);
    range.setEnd(end[0], end[1]);
    return range;
  }

  function opaque(color) {
    const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/u.exec(color || "");
    if (!match) return null;
    if (match[4] !== undefined && Number(match[4]) < 0.98) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }

  function solid(color) {
    const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/u.exec(color || "");
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  }

  function luminance(rgb) {
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  }

  function backdrop(element) {
    for (let current = element, depth = 0; current && depth < 64; current = current.parentElement, depth += 1) {
      const color = opaque(style(current).backgroundColor);
      if (color) return color;
    }
    return null;
  }

  // Neutral and per document, so a page cannot recognise the panel by it.
  const highlightName = "h" + Math.random().toString(36).slice(2, 10);
  let mark = null;
  function unmark() {
    if (mark === null) return;
    const current = mark;
    mark = null;
    current.done = true;
    try { current.highlight.clear(); } catch (_) {}
    try { CSS.highlights.delete(current.name); } catch (_) {}
    try { doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((sheet) => sheet !== current.sheet); } catch (_) {}
  }

  function scrollTo(range, reduced) {
    const host = range.startContainer.parentElement;
    if (!host) return;
    const behavior = reduced ? "auto" : "smooth";
    const box = apply(rectOf, host, []);
    if (box.height > 0 && box.height <= innerHeight * 0.8) {
      host.scrollIntoView({ block: "center", inline: "nearest", behavior });
      return;
    }
    host.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    const target = range.getBoundingClientRect();
    scrollBy({ top: target.top - innerHeight * 0.3, behavior });
  }

  // A soft highlight under the quote's own text: no element is added, so
  // nothing reflows. It eases in, holds, then fades and is gone.
  function markQuote(encoded) {
    let quote;
    try { quote = parse(encoded); } catch (_) { return "E"; }
    if (typeof quote !== "string" || quote.length > MAX_QUOTE) return "E";
    const root = doc.body || doc.documentElement;
    if (!root) return "0";
    const range = find(textIndex(root), quote);
    if (range === null) return "0";
    unmark();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollTo(range, reduced);
    if (typeof Highlight !== "function" || !globalThis.CSS || !CSS.highlights || typeof CSSStyleSheet !== "function") return "2";
    const ground = backdrop(range.startContainer.parentElement) || backdrop(root);
    const dark = ground ? luminance(ground) < 0.35 : matchMedia("(prefers-color-scheme: dark)").matches;
    const tint = dark ? "250 204 21" : "255 214 102";
    const peak = dark ? 0.34 : 0.62;
    const name = highlightName;
    // A hidden page draws no frames: show the mark at once and let it fade
    // when the page is seen again.
    const still = reduced || doc.visibilityState === "hidden";
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`::highlight(${name}){background-color:rgb(${tint} / ${still ? peak : 0});}`);
    const rule = sheet.cssRules[0];
    try {
      CSS.highlights.set(name, new Highlight(range));
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    } catch (_) {
      try { CSS.highlights.delete(name); } catch (_) {}
      return "2";
    }
    const current = { name, sheet, highlight: CSS.highlights.get(name), done: false };
    mark = current;
    const started = now(), rise = still ? 0 : 220, hold = 2600, fall = 1400;
    const frame = () => {
      if (current.done) return;
      const elapsed = now() - started;
      let alpha;
      if (elapsed < rise) alpha = peak * (elapsed / rise);
      else if (elapsed < rise + hold) alpha = peak;
      else if (elapsed < rise + hold + fall) {
        const t = (elapsed - rise - hold) / fall;
        alpha = peak * (1 - t) * (1 - t);
      } else {
        if (mark === current) unmark();
        return;
      }
      rule.style.backgroundColor = `rgb(${tint} / ${alpha.toFixed(3)})`;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    // Frames stop while the page is hidden; the mark still goes on time.
    setTimeout(() => { if (mark === current) unmark(); }, rise + hold + fall + 120);
    return "1";
  }

  const IDENT = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u;
  const GENERATED = /^(?:css|sc|jsx|emotion|svelte|astro|tw|ng|chakra|mantine)-/iu;
  function stable(token) {
    if (!IDENT.test(token) || GENERATED.test(token)) return false;
    if ((token.match(/\d/gu) || []).length >= 3) return false;
    for (const part of token.split(/[-_]+/u)) {
      if (part.length >= 5 && /\d/u.test(part) && /[A-Za-z]/u.test(part)) return false;
      if (part.length <= 8) {
        let turns = 0;
        for (let index = 1; index < part.length; index += 1) {
          const upper = part[index] !== part[index].toLowerCase();
          const previous = part[index - 1] !== part[index - 1].toLowerCase();
          if (upper !== previous) turns += 1;
        }
        if (turns >= 4) return false;
      }
      if (part.length >= 6 && /^[a-f0-9]+$/iu.test(part) && /\d/u.test(part)) return false;
    }
    return true;
  }

  function selectorOf(element) {
    let selector = lower(element.tagName);
    if (!/^[a-z][a-z0-9-]{0,31}$/u.test(selector)) return null;
    const id = element.id;
    if (typeof id === "string" && id && stable(id)) selector += "#" + id;
    let classes = 0;
    for (const token of element.classList) {
      if (classes >= 3) break;
      if (stable(token)) { selector += "." + token; classes += 1; }
    }
    return selector;
  }

  function visible(element) {
    const box = apply(rectOf, element, []);
    return box.width >= 2 && box.height >= 2;
  }

  function outline() {
    const root = doc.body;
    if (!root) return "E";
    const chosen = [], seen = new Set();
    const add = (element, kind) => {
      if (chosen.length >= MAX_NODES || !visible(element)) return;
      const selector = selectorOf(element);
      if (!selector || seen.has(selector)) return;
      seen.add(selector);
      chosen.push({ element, kind, selector });
    };
    const each = (selector, kind, limit) => {
      const found = apply(query, doc, [selector]);
      for (let index = 0, taken = 0; index < found.length && taken < limit; index += 1) {
        const before = chosen.length;
        add(found[index], kind);
        if (chosen.length > before) taken += 1;
      }
    };
    each("header, [role=banner]", "header", 2);
    each("nav, [role=navigation]", "navigation", 3);
    each("main, [role=main]", "main", 1);
    each("article", "article", 2);
    each("aside, [role=complementary]", "aside", 2);
    each("footer, [role=contentinfo]", "footer", 2);
    each("h1", "heading", 1);
    each("h2", "heading", 1);
    each("h3", "heading", 1);

    const counts = new Map();
    const scope = apply(query, doc, ["main, [role=main], article"])[0] || root;
    const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(), scanned = 0; node !== null && scanned < MAX_SCAN; node = walker.nextNode(), scanned += 1) {
      if (node.classList.length === 0 || SKIP.has(node.tagName)) continue;
      const selector = selectorOf(node);
      if (!selector || !selector.includes(".")) continue;
      const entry = counts.get(selector);
      if (entry) entry.count += 1; else counts.set(selector, { count: 1, element: node });
    }
    const repeated = [...counts.values()]
      .filter((entry) => entry.count >= 3)
      .map((entry) => ({ entry, box: apply(rectOf, entry.element, []) }))
      .filter(({ box }) => box.width >= 120 && box.height >= 40)
      .sort((a, b) => b.entry.count * b.box.width * b.box.height - a.entry.count * a.box.width * a.box.height)
      .slice(0, 8);
    for (const { entry } of repeated) add(entry.element, "content");
    each("button, [role=button], input[type=submit]", "control", 2);
    each("input[type=search], input[type=text], input:not([type])", "control", 1);
    each("a[href]", "other", 1);

    const nodes = [];
    for (const { element, kind, selector } of chosen) {
      const computed = style(element);
      const size = Math.round(parseFloat(computed.fontSize));
      let count = 0;
      try { count = Math.min(65535, apply(query, doc, [selector]).length); } catch (_) { continue; }
      nodes.push({
        s: selector,
        k: kind,
        c: count,
        b: opaque(computed.backgroundColor),
        f: solid(computed.color),
        z: size >= 1 && size <= 200 ? size : null
      });
    }

    const body = style(root);
    const background = opaque(body.backgroundColor) || opaque(style(doc.documentElement).backgroundColor);
    const text = solid(body.color);
    const content = apply(query, doc, ["main, [role=main], article"])[0] || root;
    let link = null;
    const anchors = apply(queryIn, content, ["a[href]"]);
    for (let index = 0; index < anchors.length && index < 64; index += 1) {
      if (visible(anchors[index])) { link = solid(style(anchors[index]).color); break; }
    }
    const tally = new Map();
    const actions = apply(query, doc, ["button, [role=button], input[type=submit], a[href]"]);
    for (let index = 0; index < actions.length && index < 200; index += 1) {
      const color = opaque(style(actions[index]).backgroundColor);
      if (!color) continue;
      const high = Math.max(...color), low = Math.min(...color);
      if (high === 0 || (high - low) / high < 0.25) continue;
      const key = color.join(",");
      const entry = tally.get(key);
      if (entry) entry.count += 1; else tally.set(key, { color, count: 1 });
    }
    let accent = null, best = 0;
    for (const entry of tally.values()) if (entry.count > best) { best = entry.count; accent = entry.color; }

    const fonts = [];
    for (const element of [root, apply(query, doc, ["h1, h2"])[0], content]) {
      if (!element) continue;
      for (const raw of String(style(element).fontFamily).split(",")) {
        const family = raw.trim().replace(/^["']|["']$/gu, "");
        if (fonts.length < 3 && /^[A-Za-z0-9 _-]{1,48}$/u.test(family) && !fonts.includes(family)) fonts.push(family);
      }
    }
    const dark = background ? luminance(background) < 0.35 : text ? luminance(text) > 0.6 : false;
    let wire = stringify({ n: nodes, bg: background, tx: text, ln: link, ac: accent, ft: fonts, dk: dark });
    while (wire.length > MAX_OUTLINE_BYTES && nodes.length > 0) {
      nodes.pop();
      wire = stringify({ n: nodes, bg: background, tx: text, ln: link, ac: accent, ft: fonts, dk: dark });
    }
    return wire;
  }

  // While steps hold the page: did the person press, type or scroll? Our own
  // steps' events are not trusted, so only the person's count.
  let touched = false, listening = false;
  const touch = (event) => { if (event.isTrusted) touched = true; };
  function wasTouched() {
    if (!listening) {
      listening = true;
      for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
        addEventListener(type, touch, { capture: true, passive: true });
      }
    }
    const answer = touched ? "1" : "0";
    touched = false;
    return answer;
  }

  // ---- Numbered marks and attached picks, drawn in one layer of our own ----
  // The layer sits in the top layer against the initial containing block, so
  // marks scroll with the document without any script; page elements are
  // only read, never written. Layout runs when a marked element resizes, the
  // window resizes, fonts load, or a scroller holding a mark scrolls.
  const kit = pickerKit;
  const MAX_MARKS = 12, MAX_PICKS = 3, MAX_PICK_TEXT = 4000, MAX_LABEL = 64, PICK_IDLE = 120000;
  const MAX_CANDIDATES = 6000, MAX_MATCH = 400, PAD = 4;
  const LAYER_STYLE = `
    :host { all: initial; }
    .mark, .pick { position: absolute; left: 0; top: 0; box-sizing: border-box; pointer-events: none;
      border-radius: 10px; transform-origin: center; }
    .fixed { position: fixed; }
    .hidden { display: none; }
    .mark { border: 1.5px solid rgb(var(--ink) / 0.55); background: rgb(var(--ink) / 0.035); }
    .mark.focus { border-width: 2px; border-color: rgb(var(--ink) / 0.85); background: rgb(var(--ink) / 0.07); }
    .badge { position: absolute; left: -35px; top: calc(50% - 11px); width: 22px; height: 22px; border-radius: 11px;
      display: flex; align-items: center; justify-content: center; background: rgb(var(--ink)); color: rgb(var(--paper));
      font: 600 12px/22px -apple-system, "Segoe UI", system-ui, sans-serif; font-variant-numeric: tabular-nums;
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.18); }
    .inside .badge { left: 5px; top: 5px; }
    .pick { border: 2px solid rgb(var(--ink) / 0.92); }
    .chip { position: absolute; left: 8px; top: -11px; max-width: 240px; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; padding: 2px 7px; border-radius: 6px; background: rgb(var(--ink)); color: rgb(var(--paper));
      font: 500 11px/16px -apple-system, "Segoe UI", system-ui, sans-serif; }
  `;
  const KINDS = {
    link: "a[href],area[href],[role=link]",
    heading: "h1,h2,h3,h4,h5,h6,[role=heading]",
    button: "button,summary,input[type=button],input[type=submit],input[type=reset],[role=button],[role=menuitem],[role=tab]",
    item: "li,dt,dd,[role=listitem]",
    cell: "td,th,[role=cell],[role=gridcell],[role=columnheader],[role=rowheader]",
    field: "input,textarea,select,[role=textbox],[role=searchbox],[role=combobox],[role=listbox],[role=spinbutton]",
    check: "input[type=checkbox],input[type=radio],[role=checkbox],[role=radio],[role=switch]",
    image: "img,svg,[role=img]"
  };
  const INLINE = new Set(["A", "ABBR", "B", "BDI", "BDO", "BR", "BUTTON", "CITE", "CODE", "DATA", "DFN", "EM", "FONT", "I", "IMG", "INPUT", "KBD", "LABEL", "MARK", "OUTPUT", "Q", "S", "SAMP", "SELECT", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "SVG", "TEXTAREA", "TIME", "U", "VAR", "WBR"]);
  const NOT_ITEM = new Set(["HTML", "BODY", "MAIN", "TD", "TH", "TBODY", "THEAD", "TFOOT", "TABLE", "CAPTION", "COL", "COLGROUP", "FORM", "FIELDSET", "OPTION", "OPTGROUP", "UL", "OL", "DL", "NAV", "HEADER", "FOOTER"]);
  const PROSE = new Set(["P", "BLOCKQUOTE", "PRE", "FIGCAPTION", "H1", "H2", "H3", "H4", "H5", "H6"]);
  const LISTED = new Set(["LI", "TR", "ARTICLE", "DT", "DD"]);
  const BLOCK = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "DD", "DETAILS", "DIV", "DL", "DT", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TD", "TH", "TR", "UL"]);
  const CONTENT_NAMES = { p: "Paragraph", h1: "Heading", h2: "Heading", h3: "Heading", h4: "Heading", h5: "Heading", h6: "Heading", li: "List item", tr: "Row", td: "Cell", th: "Cell", article: "Article", section: "Section", figure: "Figure", blockquote: "Quote", pre: "Code", code: "Code", main: "Main content", input: "Field", textarea: "Field", select: "Menu", label: "Label", span: "Text", div: "Section", dl: "List", dt: "Term", dd: "Description" };
  const CURRENCY = /[$\u00a3\u20ac\u00a5\u20b9]\s?\d|\d\s?(?:usd|eur|gbp|chf|jpy|z\u0142)\b/iu;
  const queryOf = (root, selector) => root === doc ? apply(query, doc, [selector]) : apply(queryIn, root, [selector]);
  const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // White space collapsed and trimmed, at most `limit` characters.
  function squeeze(value, limit) {
    const text = String(value || "");
    let out = "", gap = true;
    for (let index = 0; index < text.length && out.length < limit; index += 1) {
      const code = text.charCodeAt(index);
      if (space(code)) { if (!gap) { out += " "; gap = true; } } else { out += text[index]; gap = false; }
    }
    return gap && out.length > 0 ? out.slice(0, -1) : out;
  }

  // The names an element answers to: its text, and its accessible labels.
  function namesOf(element, kind) {
    const names = [squeeze(element.textContent && element.textContent.slice(0, MAX_MATCH * 4), MAX_MATCH)];
    for (const name of ["aria-label", "alt", "title"]) {
      const value = attribute(element, name);
      if (value) names.push(squeeze(value, MAX_MATCH));
    }
    if (element.tagName === "INPUT" && /^(?:button|submit|reset)$/u.test(lower(element.type))) names.push(squeeze(element.value, MAX_MATCH));
    if (kind === "field" || kind === "check") {
      if (element.labels) for (const label of element.labels) names.push(squeeze(label.textContent, MAX_MATCH));
      const placeholder = attribute(element, "placeholder");
      if (placeholder) names.push(squeeze(placeholder, MAX_MATCH));
    }
    return names;
  }

  function sized(element) {
    const box = apply(rectOf, element, []);
    return box.width > 0 || box.height > 0;
  }

  // The element a passage of the read came from, found again by what was
  // observed of it: its kind, text and destination, and which occurrence of
  // that it was. Nothing the page supplies is used as a selector.
  function findTarget(entry, index) {
    const wanted = [entry.t, entry.a].filter((text) => typeof text === "string" && text).map((text) => squeeze(text, MAX_MATCH));
    if (wanted.length === 0) return null;
    const same = (name) => wanted.some((text) => entry.p === true ? name.startsWith(text) : name === text);
    const selector = KINDS[entry.k];
    if (selector) {
      const found = queryOf(doc, selector);
      const matches = [];
      for (let index = 0; index < found.length && index < MAX_CANDIDATES; index += 1) {
        const element = found[index];
        if (!namesOf(element, entry.k).some(same)) continue;
        if (typeof entry.h === "string" && element.href !== entry.h) continue;
        if (sized(element)) matches.push(element);
      }
      if (matches.length > entry.o) return matches[entry.o];
      if (matches.length === 1) return matches[0];
      if (entry.k !== "item" && entry.k !== "cell") return null;
    }
    const text = squeeze(entry.t || entry.a, MAX_QUOTE);
    if (text.length < 2) return null;
    const pages = index();
    let at = -1;
    for (let seen = 0; seen <= entry.o; seen += 1) {
      const next = pages.hay.indexOf(text, at + 1);
      if (next < 0) { if (seen === 0) return null; break; }
      at = next;
    }
    const start = locate(pages, at, false);
    if (!start) return null;
    let element = start[0].parentElement;
    while (element && INLINE.has(element.tagName) && element.parentElement) element = element.parentElement;
    return element && sized(element) ? element : null;
  }

  const shares = (a, b) => {
    if (a.tagName !== b.tagName) return false;
    if (a.classList.length === 0 && b.classList.length === 0) return true;
    for (const token of a.classList) if (b.classList.contains(token)) return true;
    return false;
  };
  // Repeated among its siblings: a list item, a row, a card in a feed.
  function repeats(node) {
    const parent = node.parentElement;
    if (!parent) return false;
    const listed = LISTED.has(node.tagName) || /^(?:listitem|article|row)$/u.test(attribute(node, "role"));
    if (!listed && node.classList.length === 0) return false;
    const need = listed ? 2 : 3;
    let count = 0;
    const siblings = parent.children;
    for (let index = 0; index < siblings.length && index < 400; index += 1) {
      if (shares(siblings[index], node) && ++count >= need) return true;
    }
    return false;
  }

  function unionOf(elements) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const element of elements) {
      if (!element.isConnected) continue;
      const box = apply(rectOf, element, []);
      if (box.width === 0 && box.height === 0) continue;
      if (box.left < left) left = box.left;
      if (box.top < top) top = box.top;
      if (box.right > right) right = box.right;
      if (box.bottom > bottom) bottom = box.bottom;
    }
    return left === Infinity ? null : { left, top, right, bottom };
  }

  // An item too large to name falls back to the passage itself.
  function capped(elements, target) {
    if (elements.length === 1 && elements[0] === target) return elements;
    const box = unionOf(elements);
    if (!box) return [target];
    const width = box.right - box.left, height = box.bottom - box.top;
    return height > Math.max(innerHeight * 0.9, 480) || width * height > innerWidth * innerHeight * 0.7 ? [target] : elements;
  }

  const cells = (row) => row.cells ? row.cells.length : row.children.length;
  // A row that continues the item above it: a different cell layout, such
  // as a listing's subtext or spacer row under each item row.
  const continues = (row, head) => row.tagName === "TR" && !shares(row, head) && cells(row) !== cells(head);
  function rowsOf(row, target, clash) {
    let head = null;
    if (row.classList.length > 0 && repeats(row)) head = row;
    else {
      for (let node = row.previousElementSibling, step = 0; node && step < 3; node = node.previousElementSibling, step += 1) {
        if (node.tagName !== "TR") break;
        if (node.classList.length > 0 && repeats(node)) { head = node; break; }
        if (!continues(node, row)) break;
      }
      if (head && !continues(row, head)) head = null;
    }
    if (!head) return capped([row], target);
    const group = [head];
    for (let node = head.nextElementSibling; node && group.length < 5 && continues(node, head); node = node.nextElementSibling) group.push(node);
    while (group.length > 1 && group[group.length - 1] !== row && squeeze(group[group.length - 1].textContent, 1) === "") group.pop();
    if (!group.includes(row) || group.some((node) => node !== row && clash(node))) return capped([row], target);
    return capped(group, target);
  }

  // The item the person would name: the nearest ancestor repeated among its
  // siblings that holds no other mark; a listing's item spanning rows is
  // its rows together.
  function itemOf(target, kind, others) {
    const clash = (node) => others.some((other) => other !== target && node.contains(other));
    let node = target;
    for (let depth = 0; node && depth < 16; depth += 1, node = node.parentElement) {
      if (node === doc.body || node === doc.documentElement || clash(node)) break;
      const tag = node.tagName;
      if (tag === "TR") return rowsOf(node, target, clash);
      if (INLINE.has(tag) || NOT_ITEM.has(tag)) continue;
      if (PROSE.has(tag) && kind !== "text" && kind !== "heading") continue;
      if (repeats(node)) return capped([node], target);
    }
    return [target];
  }

  // Where a mark is drawn from: fixed with its element when that is fixed,
  // and clipped to the scrollers that hold it.
  const scrolls = (value) => value === "auto" || value === "scroll" || value === "overlay" || value === "hidden";
  function placement(target) {
    const scroller = doc.scrollingElement;
    const clips = [];
    let fixed = false;
    for (let node = target.parentElement, depth = 0; node && node !== doc.documentElement && depth < 64; node = node.parentElement, depth += 1) {
      const computed = style(node);
      if (computed.position === "fixed") { fixed = true; break; }
      if (node === scroller || node === doc.body && scroller === doc.body) continue;
      if ((scrolls(computed.overflowY) && node.scrollHeight > node.clientHeight) || (scrolls(computed.overflowX) && node.scrollWidth > node.clientWidth)) clips.push(node);
    }
    if (!fixed && style(target).position === "fixed") fixed = true;
    return { fixed, clips };
  }

  function inkOf(element) {
    const ground = backdrop(element) || (doc.body && backdrop(doc.body)) || opaque(style(doc.documentElement).backgroundColor);
    const dark = ground ? luminance(ground) < 0.35 : (() => { const text = solid(style(doc.body || doc.documentElement).color); return text ? luminance(text) > 0.6 : false; })();
    return dark ? ["255 255 255", "17 17 17"] : ["17 17 17", "255 255 255"];
  }

  let layer = null;
  function ensureLayer() {
    if (layer && layer.host.isConnected) return layer;
    if (layer) dropLayer();
    const made = kit.layer(LAYER_STYLE);
    if (!made) return null;
    const abort = new AbortController();
    layer = { host: made.host, shadow: made.shadow, marks: [], picks: [], leaving: 0, observer: null, scrollers: new Map(), abort, frame: 0, layouts: 0, observed: 0, reduced: false, focus: null };
    const current = layer;
    current.observer = new ResizeObserver(() => { if (layer === current) layout(); });
    addEventListener("resize", schedule, { passive: true, signal: abort.signal });
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => { if (layer === current) schedule(); }, () => {});
    return layer;
  }

  function dropLayer() {
    const current = layer;
    if (current === null) return;
    layer = null;
    current.abort.abort();
    for (const scroller of current.scrollers.values()) scroller.abort();
    current.scrollers.clear();
    current.observer.disconnect();
    if (current.frame) cancelAnimationFrame(current.frame);
    current.host.remove();
  }

  function releaseIfEmpty() {
    if (layer && layer.marks.length === 0 && layer.picks.length === 0 && layer.leaving === 0) dropLayer();
  }

  function schedule() {
    if (layer === null || layer.frame) return;
    const current = layer;
    current.frame = requestAnimationFrame(() => { current.frame = 0; if (layer === current) layout(); });
  }

  // Watches exactly what can move the marks; nothing else.
  function watch() {
    const current = layer;
    current.observer.disconnect();
    const watched = new Set();
    const scrollers = new Set();
    for (const entry of [...current.marks, ...current.picks]) {
      for (const element of entry.items) watched.add(element);
      for (const clip of entry.clips) scrollers.add(clip);
    }
    if (doc.documentElement) watched.add(doc.documentElement);
    for (const element of watched) current.observer.observe(element);
    current.observed = watched.size;
    for (const [scroller, abort] of current.scrollers) {
      if (!scrollers.has(scroller)) { abort.abort(); current.scrollers.delete(scroller); }
    }
    for (const scroller of scrollers) {
      if (current.scrollers.has(scroller)) continue;
      const abort = new AbortController();
      // Scroll events already come once per frame, in the frame's own steps:
      // laying out there keeps the mark on its item without a frame's lag.
      scroller.addEventListener("scroll", () => { if (layer === current) layout(); }, { passive: true, signal: abort.signal });
      current.scrollers.set(scroller, abort);
    }
  }

  function layout() {
    const current = layer;
    if (current === null) return;
    current.layouts += 1;
    const entries = [...current.marks, ...current.picks];
    const boxes = entries.map((entry) => {
      const box = unionOf(entry.items);
      if (!box) return null;
      for (const clip of entry.clips) {
        const view = apply(rectOf, clip, []);
        if (box.right < view.left || box.left > view.right || box.bottom < view.top || box.top > view.bottom) return null;
      }
      return box;
    });
    const dx = scrollX, dy = scrollY;
    entries.forEach((entry, index) => {
      const box = boxes[index], node = entry.node;
      if (!box) { node.classList.add("hidden"); return; }
      const left = box.left - PAD + (entry.fixed ? 0 : dx), top = box.top - PAD + (entry.fixed ? 0 : dy);
      node.classList.remove("hidden");
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      node.style.width = `${box.right - box.left + PAD * 2}px`;
      node.style.height = `${box.bottom - box.top + PAD * 2}px`;
      if (entry.badge) node.classList.toggle("inside", left - 36 < 2);
      entry.at = [Math.round(left), Math.round(top), Math.round(box.right - box.left + PAD * 2), Math.round(box.bottom - box.top + PAD * 2)];
    });
  }

  function entryFor(className, target, items, reduced, delay) {
    const current = ensureLayer();
    if (!current) return null;
    const { fixed, clips } = placement(target);
    const node = kit.make("div", className + (fixed ? " fixed" : ""), current.shadow);
    const [ink, paper] = inkOf(target);
    node.style.setProperty("--ink", ink);
    node.style.setProperty("--paper", paper);
    if (!reduced && typeof node.animate === "function") {
      node.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "scale(1)" }],
        { duration: 220, delay, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
    }
    return { node, target, items, fixed, clips, at: null };
  }

  function retire(entry, reduced) {
    const current = layer;
    if (!current) return;
    if (reduced || typeof entry.node.animate !== "function") { entry.node.remove(); return; }
    current.leaving += 1;
    entry.node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease-out", fill: "forwards" });
    // Frames stop while the page is hidden; the node still goes on time.
    setTimeout(() => {
      entry.node.remove();
      if (layer === current) { current.leaving -= 1; releaseIfEmpty(); }
    }, 170);
  }

  function placeMarks(encoded) {
    let request;
    try { request = parse(encoded); } catch (_) { return "E"; }
    if (!request || typeof request !== "object" || !Array.isArray(request.m) || request.m.length > MAX_MARKS) return "E";
    // A hidden page draws no frames: marks show at once there.
    const reduced = request.r === true || reducedMotion() || doc.visibilityState === "hidden";
    let pages = null;
    const index = () => pages || (pages = textIndex(doc.body || doc.documentElement));
    const found = [];
    for (const entry of request.m) {
      if (!entry || typeof entry !== "object" || !Number.isInteger(entry.n) || entry.n < 1 || entry.n > 99 ||
          !Number.isInteger(entry.o) || entry.o < 0 || entry.o > 4096 || typeof entry.k !== "string" ||
          found.some((other) => other.n === entry.n)) continue;
      const target = doc.body ? findTarget(entry, index) : null;
      if (target && !found.some((other) => other.target === target)) found.push({ n: entry.n, kind: entry.k, target });
    }
    const current = found.length > 0 ? ensureLayer() : layer;
    if (current) {
      for (const mark of current.marks.splice(0)) retire(mark, reduced);
      current.reduced = reduced;
      current.focus = null;
    }
    if (found.length === 0) {
      releaseIfEmpty();
      return "M:";
    }
    const targets = found.map((mark) => mark.target);
    found.forEach((mark, order) => {
      const entry = entryFor("mark", mark.target, itemOf(mark.target, mark.kind, targets), reduced, order * 50);
      if (!entry) return;
      entry.n = mark.n;
      entry.badge = kit.make("div", "badge", entry.node);
      entry.badge.textContent = String(mark.n);
      layer.marks.push(entry);
    });
    if (!layer) return "M:";
    watch();
    layout();
    return "M:" + layer.marks.map((mark) => mark.n).join(",");
  }

  function focusMark(encoded) {
    let request;
    try { request = parse(encoded); } catch (_) { return "E"; }
    if (!request || typeof request !== "object" || (request.n !== null && !Number.isInteger(request.n))) return "E";
    if (!layer) return "0";
    let chosen = null;
    for (const mark of layer.marks) {
      const on = mark.n === request.n;
      mark.node.classList.toggle("focus", on);
      if (on) chosen = mark;
    }
    layer.focus = chosen ? chosen.n : null;
    if (chosen && request.s === true && chosen.items[0] && chosen.items[0].isConnected) {
      const box = unionOf(chosen.items);
      const tall = box && box.bottom - box.top > innerHeight * 0.8;
      chosen.items[0].scrollIntoView({ block: tall ? "start" : "center", inline: "nearest", behavior: layer.reduced ? "auto" : "smooth" });
    }
    return chosen || request.n === null ? "1" : "0";
  }

  function clearAll() {
    endPick(null);
    pickOutcome = null;
    dropLayer();
    return "1";
  }

  // ---- The person's pick of an element, for the conversation's context ----
  const priced = (table) => {
    let hits = 0;
    const found = apply(queryIn, table, ["td,th"]);
    for (let index = 0; index < found.length && index < 400; index += 1) {
      if (CURRENCY.test(found[index].textContent.slice(0, 200)) && ++hits >= 2) return true;
    }
    return false;
  };
  const nounOf = (element) => {
    const tokens = Array.from(element.classList).map(kit.words).filter(Boolean);
    return tokens.length > 0 ? tokens[tokens.length - 1] : kit.words(element.getAttribute("id"));
  };
  // A child that repeats: classed ones first, so a listing's item rows win
  // over its spacer rows.
  function repeatedChild(element) {
    const children = element.tagName === "TABLE" ? element.rows : element.children;
    const counts = new Map();
    let best = null;
    for (let index = 0; index < children.length && index < 400; index += 1) {
      const child = children[index];
      const key = child.tagName + "|" + (child.classList[0] || "");
      if (!child.classList.length && !LISTED.has(child.tagName)) continue;
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      if (count >= 3 && (!best || (!best.classList.length && child.classList.length))) best = child;
    }
    return best;
  }
  // Only one child and no text of its own: name what it wraps.
  const wraps = (element) => {
    if (element.children.length !== 1 || element.childNodes.length > 8) return false;
    for (const node of element.childNodes) if (node.nodeType === 3 && squeeze(node.data, 1) !== "") return false;
    return true;
  };
  function contentLabel(element) {
    let inner = element;
    for (let depth = 0; depth < 3 && wraps(inner); depth += 1) inner = inner.children[0];
    const tag = inner.localName;
    let text;
    if (tag === "table" || tag === "tbody") {
      const table = tag === "tbody" ? inner.parentElement || inner : inner;
      const row = table.rows ? repeatedChild(table) : null;
      text = priced(table) ? "pricing table" : row && nounOf(row) ? nounOf(row) + " list" : "table";
    } else {
      const child = repeatedChild(inner);
      if (child) {
        const noun = nounOf(child) || nounOf(inner);
        text = noun ? noun + " list" : "list";
      } else text = nounOf(element) || lower(CONTENT_NAMES[element.localName] || kit.describe(element));
    }
    return Array.from(kit.capital(text)).slice(0, MAX_LABEL).join("");
  }

  function hidden(element) {
    if (element.hidden) return true;
    if (typeof element.checkVisibility === "function") {
      return !element.checkVisibility({ visibilityProperty: true }) && style(element).display !== "contents";
    }
    return style(element).display === "none";
  }

  // The element's visible text in reading order, one line per block. Form
  // fields are skipped whole: their values are never read.
  function visibleText(root) {
    const lines = [];
    let line = "", block = null, length = 0, visited = 0;
    const blocks = new Map();
    const blockOf = (element) => {
      let node = element;
      while (node && node !== root && !BLOCK.has(node.tagName)) node = node.parentElement;
      return node || root;
    };
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (++visited > 20000) return NodeFilter.FILTER_REJECT;
        if (node.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
        if (SKIP.has(node.tagName) || node.tagName === "OPTION" || node.isContentEditable && protectedField(node) || hidden(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    for (let node = walker.nextNode(); node !== null && length < MAX_PICK_TEXT; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent) continue;
      let owner = blocks.get(parent);
      if (owner === undefined) { owner = blockOf(parent); blocks.set(parent, owner); }
      if (owner !== block) {
        const done = line.trim();
        if (done) { lines.push(done); length += done.length + 1; }
        line = ""; block = owner;
      }
      const data = node.data;
      for (let index = 0; index < data.length; index += 1) {
        if (space(data.charCodeAt(index))) { if (line && !line.endsWith(" ")) line += " "; } else line += data[index];
      }
    }
    const done = line.trim();
    if (done) lines.push(done);
    return Array.from(lines.join("\n")).slice(0, MAX_PICK_TEXT).join("");
  }

  function pickWire(id, element) {
    const chosen = kit.candidate(element);
    return stringify({ p: id, l: contentLabel(element), t: visibleText(element), s: chosen ? chosen.selector : null });
  }

  function attach(id, element, label, reduced) {
    const current = ensureLayer();
    if (!current) return;
    for (const pick of current.picks.filter((pick) => pick.target === element || pick.id === id)) {
      current.picks.splice(current.picks.indexOf(pick), 1);
      retire(pick, reduced);
    }
    while (current.picks.length >= MAX_PICKS) retire(current.picks.shift(), reduced);
    const entry = entryFor("pick", element, [element], reduced, 0);
    if (!entry) return;
    entry.id = id;
    kit.make("div", "chip", entry.node).textContent = "\u25ce " + label;
    current.picks.push(entry);
    watch();
    layout();
  }

  let picking = null, pickOutcome = null;
  const SWALLOW = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "auxclick", "contextmenu", "keydown"];
  const PICK_BAR = [["span", "Click what to add"], ["span", "\u00b7"], ["kbd", "\u2191"], ["kbd", "\u2193"], ["span", "wider or narrower"], ["span", "\u00b7"], ["kbd", "esc"], ["span", "cancel"]];
  const PICK_ID = /^[1-9][0-9]{0,15}$/u;

  function endPick(outcome) {
    const current = picking;
    if (current === null) return;
    picking = null;
    clearTimeout(current.expiry);
    current.ui.close();
    pickOutcome = outcome;
  }

  // The person picks with their own pointer: only trusted input counts, and
  // the page never receives the press, the click or the keys meanwhile.
  function startPick(encoded) {
    let request;
    try { request = parse(encoded); } catch (_) { return "E"; }
    if (!request || typeof request !== "object" || typeof request.p !== "string" || !PICK_ID.test(request.p)) return "E";
    endPick(null);
    pickOutcome = null;
    const reduced = request.r === true || reducedMotion();
    let ui;
    try { ui = kit.session(PICK_BAR, contentLabel, reduced); } catch (_) { ui = null; }
    if (!ui) return "0";
    const current = { id: request.p, ui, expiry: 0, reduced };
    picking = current;
    const idle = () => {
      clearTimeout(current.expiry);
      current.expiry = setTimeout(() => { if (picking === current) endPick("C"); }, PICK_IDLE);
    };
    ui.moved = idle;
    const swallow = (event) => {
      if (!event.isTrusted || picking !== current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // A press before any hover frame still says where the pointer is.
      if (event.type === "pointerdown" && !ui.point) ui.point = [event.clientX, event.clientY];
      if (event.type === "keydown") {
        if (event.key === "Escape") endPick("C");
        else if (ui.key(event)) idle();
      } else if (event.type === "click" && event.button === 0) {
        const target = ui.target(event);
        if (!target) return;
        const wire = pickWire(current.id, target);
        attach(current.id, target, contentLabel(target), reduced);
        endPick(wire);
      }
    };
    for (const type of SWALLOW) addEventListener(type, swallow, { capture: true, passive: false, signal: ui.signal });
    addEventListener("pagehide", () => { if (picking === current) endPick("C"); }, { once: true, signal: ui.signal });
    idle();
    try { ui.show(); } catch (_) { endPick(null); return "0"; }
    return "1";
  }

  function picked() {
    if (pickOutcome !== null) {
      const outcome = pickOutcome;
      pickOutcome = null;
      return outcome === "C" ? "C" : "P:" + outcome;
    }
    return picking ? "W" : "N";
  }

  function readPick(id) {
    if (!PICK_ID.test(id) || !layer) return "N";
    const pick = layer.picks.find((entry) => entry.id === id);
    return pick && pick.target.isConnected ? "P:" + pickWire(id, pick.target) : "N";
  }

  function clearPick(id) {
    if (!PICK_ID.test(id) || !layer) return "1";
    const pick = layer.picks.find((entry) => entry.id === id);
    if (pick) {
      layer.picks.splice(layer.picks.indexOf(pick), 1);
      retire(pick, layer.reduced);
      releaseIfEmpty();
    }
    return "1";
  }

  // Our own drawings and how often they were laid out, for the probe.
  function overlayState() {
    const state = { h: layer !== null && layer.host.isConnected, l: layer ? layer.layouts : 0, o: layer ? layer.observed : 0, s: layer ? layer.scrollers.size : 0, f: layer ? layer.focus : null, w: picking !== null, m: [], p: [] };
    if (layer) {
      for (const mark of layer.marks) state.m.push({ n: mark.n, b: mark.at, i: mark.node.classList.contains("inside"), x: mark.fixed, k: mark.node.style.getPropertyValue("--ink") });
      for (const pick of layer.picks) state.p.push({ p: pick.id, b: pick.at });
    }
    return stringify(state);
  }

  function recipe(encoded) {
    if (typeof encoded !== "string") return "E";
    if (encoded === "Q1:touched") return wasTouched();
    if (encoded === "Q1:selection") return selection();
    if (encoded === "Q1:outline") return outline();
    if (encoded === "Q1:picked") return picked();
    if (encoded === "Q1:pickcancel") { endPick("C"); return "1"; }
    if (encoded === "Q1:clear") return clearAll();
    if (encoded === "Q1:overlay") return overlayState();
    if (encoded.startsWith("Q1:mark:")) return markQuote(encoded.slice(8));
    if (encoded.startsWith("Q1:marks:")) return placeMarks(encoded.slice(9));
    if (encoded.startsWith("Q1:markfocus:")) return focusMark(encoded.slice(13));
    if (encoded.startsWith("Q1:pick:")) return startPick(encoded.slice(8));
    if (encoded.startsWith("Q1:pickread:")) return readPick(encoded.slice(12));
    if (encoded.startsWith("Q1:pickclear:")) return clearPick(encoded.slice(13));
    return "E";
  }

  Object.defineProperty(globalThis, NAME, {
    value: Object.freeze({ recipe: Object.freeze(recipe) }),
    writable: false,
    configurable: false,
    enumerable: false
  });
})();
