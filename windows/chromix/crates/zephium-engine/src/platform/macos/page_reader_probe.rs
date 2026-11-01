//! Headless loopback qualification of the Ask panel's Browse reader.
//!
//! A WKWebView in a window that is never ordered front loads fixed loopback
//! fixtures and is driven through the production reader exactly as a Browse
//! view drives it: the main-frame navigation attempt hook and the committed
//! navigation epoch. The page reports only through its title; nothing here
//! evaluates JavaScript, so nothing here can confer user activation either.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ffi::c_void;
use std::io::{Read as _, Write as _};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::ptr::NonNull;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use objc2::rc::Retained;
use objc2::MainThreadOnly as _;
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSView, NSWindow,
    NSWindowStyleMask,
};
use objc2_foundation::{MainThreadMarker, NSDate, NSPoint, NSRect, NSRunLoop, NSSize};
use raw_window_handle::{
    AppKitWindowHandle, HandleError, HasWindowHandle, RawWindowHandle, WindowHandle,
};
use zephium_core::ids::ItemId;

use super::browse_reader::BrowseReader;
use crate::navigation_epoch::{NavigationEpochTracker, NavigationTransition};
use crate::page_reader::{PageReadFailure, PageReadout, PageRole};
use crate::platform::page_recipe::{mark_outcome, parse_outline, MarkOutcome, PageRecipe};

#[path = "page_glow_probe.rs"]
mod page_glow_probe;

const STEP_TIMEOUT: Duration = Duration::from_secs(20);

const ARTICLE: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>Rivers of the North</title>
<style>body{font-family:Georgia,serif;background:#fbfaf7;color:#1d1d1f}a{color:#0b57d0}.card{padding:12px;margin:8px;background:#fff;width:300px;height:60px}button{background:#d93025;color:#fff}</style></head>
<body><header class="site-head css-1x2y3z"><nav class="top-nav"><a href="/next">Next story</a> <a href="https://example.org/">Elsewhere</a></nav></header>
<main id="content"><article class="story">
<h1>Rivers of the North</h1>
<p id="lead">The northern rivers rose two metres overnight after the storm.</p>
<h2>What happened</h2>
<p>Engineers opened the <span id="pick">eastern floodgates at dawn</span> to relieve the pressure on the old weir.</p>
<ul><li>Roads near the Ness were closed.</li><li>Schools opened late.</li></ul>
<table><tr><th>River</th><th>Rise</th></tr><tr><td>Ness</td><td>2 m</td></tr></table>
<div class="card kCsWcF">Card one</div><div class="card kCsWcF">Card two</div><div class="card kCsWcF">Card three</div>
<form onsubmit="return false"><label>Email <input type="email" name="email" value="person@example.com"></label>
<label>Password <input type="password" name="password" value="hunter2-secret"></label>
<label>Card number <input type="text" name="cardnumber" autocomplete="cc-number" value="4111 1111 1111 1111"></label>
<label>Code <input type="text" name="otp" autocomplete="one-time-code" value="928374"></label>
<label>Search <input type="search" name="q" value="flood maps"></label><button type="submit">Send report</button></form>
</article><aside class="related">Related stories</aside></main>
<footer class="site-foot">Fixture footer</footer>
<script src="/watch.js"></script></body></html>"#;

// Runs in the page's own world. It watches, as tightly as the page can,
// for any user activation, any popup that gets through, and any sign of the
// reader's private world; it reports only when the probe asks.
const WATCH: &str = r##"(() => {
  const pick = document.getElementById("pick");
  if (pick) getSelection().selectAllChildren(pick);
  const shape = () => [document.documentElement.scrollHeight, document.getElementById("lead").offsetHeight, pick.offsetWidth, pick.offsetLeft].join(",");
  const initial = shape();
  let active = false, been = false, opened = 0, attempts = 0, samples = 0, marked = false;
  const leaks = new Set();
  const names = ["__zephiumSemanticRuntimeV1", "__zephiumPageAssistV1", "__zephiumHumanSurveyV1", "__zephiumRecordMediaV1", "__zephiumPixelPrivacyV1"];
  let running = true;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    if (!running) return;
    samples++;
    const ua = navigator.userActivation;
    if (ua && ua.isActive) active = true;
    if (ua && ua.hasBeenActive) been = true;
    attempts++;
    try { const w = window.open("about:blank", "_blank"); if (w) { opened++; try { w.close(); } catch (_) {} } } catch (_) {}
    if ((samples & 63) === 0) {
      for (const name of names) if (name in globalThis) leaks.add(name);
      try {
        const h = window.webkit && window.webkit.messageHandlers;
        if (h && (h.zephiumPageAssistBootV1 || h.zephiumPageAssistV1 || h.zephiumSemanticRuntimeV1)) leaks.add("handler");
      } catch (_) {}
    }
    try { if (globalThis.CSS && CSS.highlights && CSS.highlights.size > 0) marked = true; } catch (_) {}
    channel.port2.postMessage(0);
  };
  channel.port2.postMessage(0);
  addEventListener("hashchange", () => {
    if (!location.hash.startsWith("#report")) return;
    running = false;
    document.title = `report ${location.hash.slice(7)} sheets=${document.adoptedStyleSheets.length} layout=${shape() === initial ? "same" : "changed"} active=${active} been=${been} opened=${opened} attempts=${attempts} samples=${samples} marked=${marked} highlights=${globalThis.CSS && CSS.highlights ? [...CSS.highlights.keys()].join(",") : "none"} leaks=${[...leaks].join("|") || "none"}`;
  });
})();"##;

const CACHE_A: &str = r#"<!doctype html><meta charset="utf-8"><title>A</title><h1>Page A</h1><p>Alpha text only page A has.</p><script>addEventListener("pageshow", e => { if (e.persisted) document.title = "A restored"; });</script>"#;
const CACHE_B: &str = r#"<!doctype html><meta charset="utf-8"><title>B</title><h1>Page B</h1><p>Beta text only page B has.</p><script>addEventListener("pageshow", e => { if (e.persisted) document.title = "B restored"; });</script>"#;

// A form whose name field behaves like a controlled input: the page keeps
// its own state from input events and renders the field from it.
const FORM: &str = r#"<!doctype html><meta charset="utf-8"><title>Checkout</title>
<style>body{font:16px sans-serif} input,button,select{display:block;margin:8px;width:240px;height:28px}</style>
<main><h1>Checkout</h1>
<label>Name <input id="name" type="text" value=""></label>
<label>Password <input id="pw" type="password" value=""></label>
<label>Size <select id="size"><option>Small</option><option>Large</option></select></label>
<label><input id="gift" type="checkbox" style="width:auto"> Gift wrap</label>
<button id="slow" type="button">Check stock</button>
<button id="order" type="button">Place order</button>
<p id="echo">state:</p><a href="/next">Next story</a></main>
<script src="/form.js"></script>"#;
const FORM_JS: &str = r#"(() => {
  const name = document.getElementById("name"), echo = document.getElementById("echo");
  let state = "";
  const render = () => { name.value = state; echo.textContent = "state:" + state; };
  name.addEventListener("input", () => { state = name.value; render(); });
  name.addEventListener("blur", render);
  document.getElementById("order").addEventListener("click", () => { echo.textContent = "ordered"; });
  document.getElementById("slow").addEventListener("click", () => { const end = performance.now() + 600; while (performance.now() < end) {} });
})();"#;

const NEXT: &str = r#"<!doctype html><meta charset="utf-8"><title>Next</title><h1>The next story</h1><p>A second document for navigation checks.</p>"#;

fn heavy() -> String {
    let mut page =
        String::from("<!doctype html><meta charset=\"utf-8\"><title>Heavy</title><main><article>");
    for section in 0..200 {
        page.push_str(&format!("<h2>Section {section}</h2>"));
        for paragraph in 0..15 {
            page.push_str(&format!(
                "<p>Paragraph {paragraph} of section {section}: the committee reviewed the long record of river levels, \
                 rainfall, and the maintenance history of every gate along the northern channel before it agreed.</p>"
            ));
        }
        page.push_str("<ul><li>One point</li><li>Another point</li><li>A last point</li></ul>");
    }
    page.push_str("</article></main>");
    page
}

// Runs in the Assistant fixtures' own world: what the page can tell of our
// drawings and picker (mutations, clicks, keys, activation), the rows'
// geometry, and scrolling on request. It reports through its title. A
// window never shown renders only when the probe takes a snapshot, so
// nothing here waits for a frame.
const ASSIST_WATCH: &str = r##"(() => {
  let active = false, been = false, opened = 0, attrs = 0, inside = 0, clicks = 0, downs = 0, keys = 0, sampled = 0;
  const added = [];
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") { if (document.body && document.body.contains(record.target)) attrs++; }
      else if (record.target === document.documentElement) { for (const node of record.addedNodes) added.push(node.nodeName); }
      else if (document.body && document.body.contains(record.target)) inside++;
    }
  }).observe(document.documentElement, { attributes: true, childList: true, subtree: true, characterData: true });
  document.addEventListener("click", () => clicks++, true);
  document.addEventListener("pointerdown", () => downs++, true);
  document.addEventListener("keydown", () => keys++, true);
  let moves = 0;
  document.addEventListener("pointermove", () => moves++, true);
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    sampled++;
    const ua = navigator.userActivation;
    if (ua && ua.isActive) active = true;
    if (ua && ua.hasBeenActive) been = true;
    try { const w = window.open("about:blank", "_blank"); if (w) { opened++; try { w.close(); } catch (_) {} } } catch (_) {}
    setTimeout(() => channel.port2.postMessage(0), 4);
  };
  channel.port2.postMessage(0);
  const box = (elements) => {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      l = Math.min(l, rect.left); t = Math.min(t, rect.top); r = Math.max(r, rect.right); b = Math.max(b, rect.bottom);
    }
    return [Math.round(l + scrollX), Math.round(t + scrollY), Math.round(r - l), Math.round(b - t)];
  };
  const item = (id) => {
    const element = document.getElementById(id);
    if (!element) return null;
    if (element.tagName === "TR") return box([element, element.nextElementSibling]);
    return box([element]);
  };
  addEventListener("hashchange", () => {
    const hash = decodeURIComponent(location.hash.slice(1));
    const [verb, label, arg] = hash.split("~");
    if (verb === "s") { scrollTo(0, Number(arg)); }
    if (verb === "i") { const inner = document.getElementById("inner"); if (inner) inner.scrollTop = Number(arg); }
    const report = (rest) => { document.title = `assist ${label} ${rest}`; };
    const finish = () => {
      const items = (arg || "").split(",").filter(Boolean).map((id) => [id, item(id)]);
      report(`attrs=${attrs} inside=${inside} html=${document.documentElement.children.length} added=${added.join("|") || "none"} active=${active} been=${been} opened=${opened} clicks=${clicks} downs=${downs} keys=${keys} moves=${moves} sampled=${sampled} scroll=${Math.round(scrollY)} inner=${document.getElementById("inner") ? document.getElementById("inner").scrollTop : -1} items=${JSON.stringify(Object.fromEntries(items))}`);
    };
    setTimeout(finish, 30);
  });
})();"##;

fn listing() -> String {
    let mut page = String::from(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Listing</title>\
         <style>body{font:13px Verdana,sans-serif;background:#f6f6ef;color:#222;margin:0}\
         #hnmain{margin:8px 0 0 60px;width:820px;border-collapse:collapse}td{padding:1px 4px}\
         .spacer{height:5px}.subtext{font-size:10px;color:#828282}a{color:#000}</style></head><body>\
         <p style=\"margin-left:60px\"><a href=\"https://person:secret@example.org/private\">Signed link</a> \
         <a href=\"mailto:someone@example.org\">Mail link</a></p><table id=\"hnmain\"><tbody>",
    );
    for n in 1..=30 {
        page.push_str(&format!(
            "<tr class=\"athing story\" id=\"{n}\"><td class=\"title rank\">{n}.</td><td class=\"votelinks\">^</td>\
             <td class=\"title\"><span class=\"titleline\"><a id=\"t{n}\" href=\"https://example.org/story/{n}\">Story number {n} about rivers</a> \
             <span class=\"sitebit\">(example.org)</span></span></td></tr>\
             <tr><td colspan=\"2\"></td><td class=\"subtext\"><span class=\"score\">{} points</span> by \
             <a href=\"/user?id=u{n}\">u{n}</a> <a href=\"/item?id={n}\">{n} hours ago</a> | \
             <a href=\"/item?id={n}\">{n} comments</a></td></tr><tr class=\"spacer\"></tr>",
            n + 10
        ));
    }
    page.push_str(
        "</tbody></table><form id=\"f\" onsubmit=\"return false\" style=\"margin-left:60px;width:400px\"><label id=\"email\">Email address \
         <input name=\"email\" value=\"person@example.com\"></label><br><label>Password <input type=\"password\" value=\"hunter2-secret\"></label><br>\
         <textarea>draft text</textarea><select><option>Opt A</option></select></form><script src=\"/assist.js\"></script></body></html>",
    );
    page
}

fn feed() -> String {
    let mut page = String::from(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Feed</title>\
         <style>body{font:15px system-ui,sans-serif;background:#16181d;color:#e8e8ea;margin:0;padding:24px 80px}\
         .feed{display:grid;grid-template-columns:repeat(3,260px);gap:16px}.card{background:#22252c;border-radius:12px;padding:14px}\
         .card h3{margin:0 0 6px;font-size:16px}a{color:#8ab4f8}#inner{height:160px;overflow:auto;margin-top:24px;width:420px;background:#1d2026}\
         #inner li{height:28px}</style></head><body><main><div class=\"feed\">",
    );
    for n in 1..=12 {
        page.push_str(&format!(
            "<div class=\"card\" id=\"card{n}\"><h3>Card title {n}</h3><p>A short body for card {n}.</p>\
             <a href=\"/post/{n}\">Read post {n}</a></div>"
        ));
    }
    page.push_str("</div><ul id=\"inner\">");
    for n in 1..=20 {
        page.push_str(&format!(
            "<li class=\"row\" id=\"row{n}\">Scrolled row {n}</li>"
        ));
    }
    page.push_str("</ul></main><script src=\"/assist.js\"></script></body></html>");
    page
}

// Hacker News's footer: a search form whose only field has no label, no
// placeholder and no title, submitted by Return alone; beside it, fields
// named only by their description, their form name or nothing.
const HN: &str = r##"<!doctype html><html><head><meta charset="utf-8"><title>Hacker News</title>
<style>body{font:10pt Verdana,sans-serif;background:#f6f6ef;margin:0}#hnmain{width:85%;margin:8px auto}</style></head>
<body><center><table id="hnmain" border="0" cellpadding="0" cellspacing="0"><tbody>
<tr><td bgcolor="#ff6600"><b>Hacker News</b> <a href="/newest">new</a> | <a href="/ask">ask</a></td></tr>
<tr><td><table><tr class="athing"><td class="title"><a href="https://example.org/a">Rivers rise in the north</a></td></tr></table></td></tr>
<tr><td><center><span class="yclinks"><a href="/guidelines">Guidelines</a> | <a href="/faq">FAQ</a></span><br><br>
<form method="get" action="/search">Search: <input type="text" name="q" size="17" autocorrect="off" spellcheck="false" autocapitalize="off" autocomplete="off"></form>
<p><input type="text" name="shipping_notes"> <input type="text" aria-description="Promo code"> <select name="sortOrder"><option>New</option><option>Top</option></select>
<input type="checkbox"> Keep me posted <input type="text" disabled> <input type="text"></p>
</center></td></tr></tbody></table></center></body></html>"##;

// A new Notion page: the title and an empty body block are bare editable
// leaves named only by the placeholder their `::before` shows, beside a
// "Get started with" row of buttons. Return in the title is the page's own:
// it moves the caret into the body. Below, a ProseMirror comment box (Linear,
// Docs-like) whose placeholder sits on its empty paragraph and whose Return
// the page leaves to the browser.
const NOTION: &str = r##"<!doctype html><html><head><meta charset="utf-8"><title>New page</title>
<style>body{font:16px -apple-system,sans-serif;margin:0;color:#37352f;background:#fff}
.page{max-width:640px;margin:60px auto}[contenteditable]{outline:none;white-space:pre-wrap}
[placeholder]:empty::before,p.is-empty::before{content:attr(placeholder);color:#9b9a97;pointer-events:none}
p.is-empty::before{content:attr(data-placeholder)}h1{font-size:40px;margin:0 0 12px}
.block{min-height:24px;padding:3px 2px}.start{display:flex;gap:10px;color:#9b9a97;margin:18px 0}
.start [role=button]{cursor:pointer;padding:2px 8px;border-radius:4px;background:#f1f1ef}
.ProseMirror{border:1px solid #ddd;border-radius:6px;padding:8px;margin-top:40px}</style></head>
<body><div class="notion-app"><main class="notion-frame"><div class="page notion-page-content">
<div class="notion-page-block"><h1><div id="title" class="notranslate" spellcheck="true" placeholder="New page" data-content-editable-leaf="true" contenteditable="true"></div></h1></div>
<div class="notion-selectable notion-text-block" data-block-id="b1"><div><div id="body" class="block notranslate" spellcheck="true" placeholder="Press '/' for commands" data-content-editable-leaf="true" contenteditable="true"></div></div></div>
<div class="start"><div>Get started with</div><div role="button" tabindex="0">Ask AI</div><div role="button" tabindex="0">Templates</div></div>
<div id="comment" class="ProseMirror" contenteditable="true" translate="no"><p data-placeholder="Leave a comment…" class="is-empty"><br class="ProseMirror-trailingBreak"></p></div>
</div></main></div>
<script>(() => {
  const title = document.getElementById("title"), body = document.getElementById("body"), comment = document.getElementById("comment");
  let active = false, been = false, clicks = 0, opened = 0;
  document.addEventListener("click", () => clicks++, true);
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    const ua = navigator.userActivation;
    if (ua && ua.isActive) active = true;
    if (ua && ua.hasBeenActive) been = true;
    try { const w = window.open("about:blank", "_blank"); if (w) { opened++; w.close(); } } catch (_) {}
    setTimeout(() => channel.port2.postMessage(0), 4);
  };
  channel.port2.postMessage(0);
  title.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    body.focus();
    const range = document.createRange();
    range.selectNodeContents(body);
    range.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  title.addEventListener("input", () => { document.title = title.textContent || "New page"; });
  // The body's own Return listens to trusted keys only and takes the
  // browser's paragraph instead: a new block after it, caret inside.
  body.addEventListener("keydown", (event) => { if (event.isTrusted && event.key === "Enter") event.preventDefault(); });
  body.addEventListener("beforeinput", (event) => {
    if (event.inputType !== "insertParagraph") return;
    event.preventDefault();
    const block = document.createElement("div");
    block.id = "next";
    block.className = "block";
    block.contentEditable = "true";
    block.setAttribute("placeholder", "Press '/' for commands");
    body.closest(".notion-text-block").after(block);
    block.focus();
  });
  comment.addEventListener("input", () => {
    const empty = comment.textContent === "";
    for (const p of comment.querySelectorAll("p")) {
      p.classList.toggle("is-empty", empty);
      if (empty) p.setAttribute("data-placeholder", "Leave a comment\u2026"); else p.removeAttribute("data-placeholder");
    }
  });
  addEventListener("hashchange", () => {
    if (!location.hash.startsWith("#report-")) return;
    const focus = document.activeElement && document.activeElement.id || "none";
    const words = (text) => (text || "").replace(/\s/g, "+");
    const paragraphs = [...comment.querySelectorAll("p")].map(p => words(p.textContent) || "_").join("|");
    const blocks = document.querySelectorAll(".block").length;
    document.title = `notion ${location.hash.slice(8)} focus=${focus} blocks=${blocks} title=${words(title.textContent)} body=${words(body.textContent)} comment=${paragraphs} active=${active} been=${been} opened=${opened} clicks=${clicks}`;
  });
})();</script></body></html>"##;

fn search_results(path: &str) -> String {
    let query = url::Url::parse(&format!("http://fixture{path}"))
        .ok()
        .and_then(|url| {
            url.query_pairs()
                .find(|(k, _)| k == "q")
                .map(|(_, v)| v.into_owned())
        })
        .unwrap_or_default()
        .replace(['<', '>', '&', '"'], "");
    format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Search</title><h1>Results for {query}</h1>"
    )
}

struct Fixture {
    address: SocketAddr,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl Fixture {
    fn start() -> Result<Self, String> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("bind: {e}"))?;
        let address = listener.local_addr().map_err(|e| format!("address: {e}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("nonblocking: {e}"))?;
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let heavy = Arc::new(heavy());
        let worker = std::thread::Builder::new()
            .name("zephium-page-reader-probe-http".into())
            .spawn(move || {
                while !thread_stop.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let heavy = heavy.clone();
                            let _ = std::thread::Builder::new()
                                .name("zephium-page-reader-probe-connection".into())
                                .spawn(move || serve(stream, &heavy));
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(2));
                        }
                        Err(_) => break,
                    }
                }
            })
            .map_err(|e| format!("spawn: {e}"))?;
        Ok(Self {
            address,
            stop,
            worker: Some(worker),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.address)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn serve(mut stream: TcpStream, heavy: &str) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut request = [0_u8; 8 * 1024];
    let mut received = 0;
    while received < request.len() {
        match stream.read(&mut request[received..]) {
            Ok(0) | Err(_) => return,
            Ok(read) => {
                received += read;
                if request[..received].windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
        }
    }
    let head = String::from_utf8_lossy(&request[..received]);
    let path = head
        .split_whitespace()
        .nth(1)
        .unwrap_or("/")
        .split('#')
        .next()
        .unwrap_or("/")
        .to_owned();
    let generated = match path.as_str() {
        "/listing" | "/listing-csp" => listing(),
        search if search.starts_with("/search?") => search_results(search),
        "/feed" => feed(),
        "/slow" => {
            std::thread::sleep(Duration::from_millis(1_500));
            NEXT.to_owned()
        }
        _ => String::new(),
    };
    let (body, kind, csp): (&str, &str, Option<&str>) = match path.as_str() {
        "/assist.js" => (ASSIST_WATCH, "text/javascript", None),
        "/listing" | "/feed" | "/slow" => (&generated, "text/html; charset=utf-8", None),
        search if search.starts_with("/search?") => (&generated, "text/html; charset=utf-8", None),
        "/hn" => (HN, "text/html; charset=utf-8", None),
        "/notion" => (NOTION, "text/html; charset=utf-8", None),
        "/listing-csp" => (
            &generated,
            "text/html; charset=utf-8",
            Some("script-src 'self'; object-src 'none'; base-uri 'none'"),
        ),
        "/watch.js" => (WATCH, "text/javascript", None),
        "/form.js" => (FORM_JS, "text/javascript", None),
        "/form" => (FORM, "text/html; charset=utf-8", None),
        "/article" | "/sensitive" => (ARTICLE, "text/html; charset=utf-8", None),
        "/plain" => (
            ARTICLE.trim_end_matches("<script src=\"/watch.js\"></script></body></html>"),
            "text/html; charset=utf-8",
            None,
        ),
        "/csp" => (
            ARTICLE,
            "text/html; charset=utf-8",
            Some("script-src 'self'; object-src 'none'; base-uri 'none'"),
        ),
        "/tt" => (
            ARTICLE,
            "text/html; charset=utf-8",
            Some("script-src 'self'; require-trusted-types-for 'script'; trusted-types 'none'"),
        ),
        "/strict" => (
            ARTICLE,
            "text/html; charset=utf-8",
            Some("default-src 'self'; style-src 'self' 'unsafe-inline'"),
        ),
        "/heavy" => (heavy, "text/html; charset=utf-8", None),
        "/cache-a" => (CACHE_A, "text/html; charset=utf-8", None),
        "/cache-b" => (CACHE_B, "text/html; charset=utf-8", None),
        "/next" => (NEXT, "text/html; charset=utf-8", None),
        _ => ("not found", "text/plain", None),
    };
    // The back-forward pages are cacheable, as most of the web is.
    let cache = if path.starts_with("/cache-") {
        "Cache-Control: max-age=60"
    } else {
        "Cache-Control: no-store"
    };
    let mut response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\n{cache}\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(csp) = csp {
        response.push_str(&format!("Content-Security-Policy: {csp}\r\n"));
    }
    response.push_str("\r\n");
    response.push_str(body);
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

struct Host {
    view: Retained<NSView>,
}

impl HasWindowHandle for Host {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let pointer = NonNull::from(&*self.view).cast::<c_void>();
        let raw = RawWindowHandle::AppKit(AppKitWindowHandle::new(pointer));
        // SAFETY: `self.view` owns the exact NSView for this borrow and the
        // retained window outlives the Wry child.
        Ok(unsafe { WindowHandle::borrow_raw(raw) })
    }
}

#[derive(Default)]
struct PageState {
    title: String,
    popups: usize,
    finished: u64,
}

struct Probe {
    _window: Retained<NSWindow>,
    _host: Host,
    view: wry::WebView,
    reader: Rc<RefCell<Option<BrowseReader>>>,
    navigation: NavigationEpochTracker,
    state: Rc<RefCell<PageState>>,
    sensitive: Rc<Cell<bool>>,
    tab: ItemId,
    tab_cell: Rc<Cell<ItemId>>,
}

fn pump(until: impl Fn() -> bool, what: &str) -> Result<(), String> {
    let run_loop = NSRunLoop::mainRunLoop();
    let deadline = Instant::now() + STEP_TIMEOUT;
    while !until() {
        if Instant::now() >= deadline {
            return Err(format!("timed out {what}"));
        }
        objc2::rc::autoreleasepool(|_| {
            run_loop.runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.002));
        });
    }
    Ok(())
}

fn settle(duration: Duration) {
    let end = Instant::now() + duration;
    let _ = pump(|| Instant::now() >= end, "settling");
}

impl Probe {
    fn new(mtm: MainThreadMarker, enabled: bool) -> Result<Self, String> {
        // SAFETY: `mtm` proves AppKit affinity; the window is never ordered
        // front and outlives its host view and the Wry child.
        let window = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1024.0, 768.0)),
                NSWindowStyleMask::Borderless,
                NSBackingStoreType::Buffered,
                false,
            )
        };
        // SAFETY: the probe keeps the retained window until teardown.
        unsafe { window.setReleasedWhenClosed(false) };
        // Pointer moves reach the page as the person's do in a shown window.
        window.setAcceptsMouseMovedEvents(true);
        let host = Host {
            view: window
                .contentView()
                .ok_or_else(|| "probe window has no content view".to_owned())?,
        };
        let state = Rc::new(RefCell::new(PageState::default()));
        let reader: Rc<RefCell<Option<BrowseReader>>> = Rc::default();
        let navigation = NavigationEpochTracker::new();
        let sensitive = Rc::new(Cell::new(false));
        let tab = ItemId::generate();
        let title_state = state.clone();
        let popup_state = state.clone();
        let attempt_reader = Rc::downgrade(&reader);
        let attempt_sensitive = sensitive.clone();
        let commit_reader = Rc::downgrade(&reader);
        let kind_reader = Rc::downgrade(&reader);
        let commit_navigation = navigation.clone();
        let finish_state = state.clone();
        let view = wry::WebViewBuilder::new()
            .with_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0.0, 0.0).into(),
                size: wry::dpi::LogicalSize::new(1024.0, 768.0).into(),
            })
            .with_incognito(true)
            .with_document_title_changed_handler(move |title| {
                title_state.borrow_mut().title = title;
            })
            .with_new_window_req_handler(move |_url, _features| {
                popup_state.borrow_mut().popups += 1;
                wry::NewWindowResponse::Deny
            })
            .with_apple_navigation_action_handler(move |_target, action| {
                if action.target_is_main_frame == Some(true) {
                    if let Some(reader) = kind_reader.upgrade() {
                        if let Some(reader) = reader.borrow().as_ref() {
                            reader.back_forward(
                                action.navigation_type == wry::AppleNavigationType::BackForward,
                            );
                        }
                    }
                }
                true
            })
            .with_main_frame_navigation_attempt_handler(move |target| {
                let admitted = enabled_and_admitted(&attempt_sensitive, &target);
                if let Some(reader) = attempt_reader.upgrade() {
                    if let Some(reader) = reader.borrow().as_ref() {
                        reader.attempt(admitted, &target);
                    }
                }
            })
            .with_navigation_event_handler(move |event| {
                match commit_navigation.observe_navigation(&event) {
                    Some(NavigationTransition::Committed(epoch)) => {
                        if let Some(reader) = commit_reader.upgrade() {
                            if let Some(reader) = reader.borrow().as_ref() {
                                reader.commit(epoch.presentation_id().into_raw(), &event.url);
                            }
                        }
                    }
                    Some(NavigationTransition::Finished(_)) => {
                        finish_state.borrow_mut().finished += 1;
                    }
                    _ => {}
                }
            })
            .build_as_child(&host)
            .map_err(|e| format!("cannot build probe WebView: {e}"))?;
        // A window never shown is a hidden page; let it run at full speed
        // so the page's watch loop samples as tightly as it can.
        let page = super::native_webview(&view);
        // SAFETY: main-thread WebKit access on the probe's own view.
        unsafe {
            page.configuration()
                .preferences()
                .setInactiveSchedulingPolicy(objc2_web_kit::WKInactiveSchedulingPolicy::None);
        }
        let committed = navigation.clone();
        let settled = navigation.clone();
        let tab_cell = Rc::new(Cell::new(tab));
        *reader.borrow_mut() = BrowseReader::new(
            &super::native_webview(&view),
            tab_cell.clone(),
            enabled,
            Rc::new(move || {
                committed
                    .current_committed()
                    .map(|epoch| epoch.presentation_id().into_raw())
            }),
            Rc::new(move || settled.current() == settled.current_committed()),
        );
        if reader.borrow().is_none() {
            return Err("this WebKit cannot host the reader".to_owned());
        }
        Ok(Self {
            _window: window,
            _host: host,
            view,
            reader,
            navigation,
            state,
            sensitive,
            tab,
            tab_cell,
        })
    }

    /// Goes back, or forward, as the person's history buttons do.
    fn history(&self, forward: bool) {
        let page = super::native_webview(&self.view);
        // SAFETY: main-thread WebKit navigation on the probe's own view.
        unsafe {
            if forward {
                let _ = page.goForward();
            } else {
                let _ = page.goBack();
            }
        }
    }

    fn interaction_state(&self) -> Option<Retained<objc2_foundation::NSData>> {
        let page = super::native_webview(&self.view);
        // SAFETY: main-thread property read; objc2 retains the result.
        unsafe { page.interactionState() }?
            .downcast::<objc2_foundation::NSData>()
            .ok()
    }

    /// Restores a saved session, as a discarded tab is brought back.
    fn restore(&self, state: &objc2_foundation::NSData) {
        let page = super::native_webview(&self.view);
        // SAFETY: the exact data came from interactionState on a view of
        // the same kind; the setter starts the navigation itself.
        unsafe { page.setInteractionState(Some(state)) };
    }

    fn epoch(&self) -> Option<u64> {
        self.navigation
            .current_committed()
            .map(|epoch| epoch.presentation_id().into_raw())
    }

    fn load(&self, url: &str) -> Result<u64, String> {
        let before = self.state.borrow().finished;
        let _ = self.navigation.begin(url);
        self.view
            .load_url(url)
            .map_err(|e| format!("load {url}: {e}"))?;
        pump(
            || self.state.borrow().finished > before,
            &format!("loading {url}"),
        )?;
        self.epoch().ok_or_else(|| "no committed epoch".to_owned())
    }

    fn wait_readable(&self) -> Result<(), String> {
        pump(
            || crate::page_reader::readable(self.tab_cell.get()),
            "for the boot pull",
        )
        .map_err(|error| {
            format!(
                "{error} (published {:?}, committed {:?}, current {:?})",
                crate::page_reader::committed_epoch(self.tab_cell.get()),
                self.epoch(),
                self.navigation
                    .current()
                    .map(|epoch| epoch.presentation_id().into_raw())
            )
        })
    }

    fn read(&self, epoch: u64, url: &str) -> (Result<PageReadout, PageReadFailure>, Duration) {
        let slot: Arc<Mutex<Option<Result<PageReadout, PageReadFailure>>>> = Arc::default();
        let answer = slot.clone();
        let started = Instant::now();
        if let Some(reader) = self.reader.borrow().as_ref() {
            reader.read(
                epoch,
                url.to_owned(),
                Box::new(move |result| {
                    *answer.lock().unwrap_or_else(|p| p.into_inner()) = Some(result);
                }),
            );
        }
        // The host's timers re-run the queue in the app; here the wait does.
        let done = || {
            if let Some(reader) = self.reader.borrow().as_ref() {
                reader.pump();
            }
            slot.lock().unwrap_or_else(|p| p.into_inner()).is_some()
        };
        if pump(done, "for a read").is_err() {
            return (Err(PageReadFailure::Unavailable), started.elapsed());
        }
        let elapsed = started.elapsed();
        let result = slot
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
            .unwrap_or(Err(PageReadFailure::Unavailable));
        (result, elapsed)
    }

    fn recipe(&self, epoch: u64, recipe: PageRecipe) -> (Option<String>, Duration) {
        let slot: Arc<Mutex<Option<Option<String>>>> = Arc::default();
        let answer = slot.clone();
        let started = Instant::now();
        if let Some(reader) = self.reader.borrow().as_ref() {
            reader.recipe(
                epoch,
                recipe,
                Box::new(move |result| {
                    *answer.lock().unwrap_or_else(|p| p.into_inner()) = Some(result);
                }),
            );
        }
        // The host's timers re-run the queue in the app; here the wait does.
        let done = || {
            if let Some(reader) = self.reader.borrow().as_ref() {
                reader.pump();
            }
            slot.lock().unwrap_or_else(|p| p.into_inner()).is_some()
        };
        if pump(done, "for a recipe").is_err() {
            return (None, started.elapsed());
        }
        let elapsed = started.elapsed();
        let result = slot
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
            .flatten();
        (result, elapsed)
    }

    /// Runs one step and waits for it, driving the reader's queue and its
    /// lease the way the host's timers do.
    fn act(
        &self,
        epoch: u64,
        read: u64,
        url: &str,
        proposal: zephium_agentic::SemanticActionProposal,
    ) -> Result<(), crate::page_reader::PageActFailure> {
        let slot: Arc<Mutex<Option<Result<(), crate::page_reader::PageActFailure>>>> =
            Arc::default();
        let answer = slot.clone();
        if let Some(reader) = self.reader.borrow().as_ref() {
            reader.act(
                epoch,
                read,
                url.to_owned(),
                proposal,
                Box::new(move |result| {
                    *answer.lock().unwrap_or_else(|p| p.into_inner()) = Some(result);
                }),
            );
        }
        let done = || {
            if let Some(reader) = self.reader.borrow().as_ref() {
                reader.pump();
            }
            slot.lock().unwrap_or_else(|p| p.into_inner()).is_some()
        };
        pump(done, "for a step").map_err(|_| crate::page_reader::PageActFailure::Failed)?;
        let result = slot
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
            .unwrap_or(Err(crate::page_reader::PageActFailure::Failed));
        result
    }

    /// Presses a key into the page as the person's keyboard would.
    fn press_key(&self) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let page = super::native_webview(&self.view);
        let characters = objc2_foundation::NSString::from_str("a");
        let event = {
            objc2_app_kit::NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                objc2_app_kit::NSEventType::KeyDown,
                NSPoint::new(10.0, 10.0),
                objc2_app_kit::NSEventModifierFlags::empty(),
                0.0,
                self._window.windowNumber(),
                None,
                &characters,
                &characters,
                false,
                0,
            )
        };
        let _ = mtm;
        if let Some(event) = event {
            page.keyDown(&event);
        }
    }

    /// The view's pixels, through WebKit's snapshot API (no script).
    fn snapshot(&self) -> Option<Retained<objc2_app_kit::NSBitmapImageRep>> {
        let mtm = MainThreadMarker::new()?;
        let page = super::native_webview(&self.view);
        // SAFETY: main-thread WebKit object creation and configuration.
        let configuration = unsafe { objc2_web_kit::WKSnapshotConfiguration::new(mtm) };
        // SAFETY: as above; a live configuration on the main thread.
        unsafe { configuration.setAfterScreenUpdates(true) };
        let slot: Rc<RefCell<Option<Option<Retained<objc2_app_kit::NSBitmapImageRep>>>>> =
            Rc::default();
        let answer = slot.clone();
        let callback = block2::RcBlock::new(
            move |image: *mut objc2_app_kit::NSImage, _error: *mut objc2_foundation::NSError| {
                let rep = (!image.is_null())
                    .then(|| {
                        // SAFETY: WebKit keeps a non-null image valid for the
                        // callback; a null proposed rectangle is allowed.
                        let cg = unsafe {
                            (*image).CGImageForProposedRect_context_hints(
                                std::ptr::null_mut(),
                                None,
                                None,
                            )
                        }?;
                        Some(objc2_app_kit::NSBitmapImageRep::initWithCGImage(
                            <objc2_app_kit::NSBitmapImageRep as objc2::AnyThread>::alloc(),
                            &cg,
                        ))
                    })
                    .flatten();
                *answer.borrow_mut() = Some(rep);
            },
        );
        // SAFETY: WebKit copies the block and replies once on the main thread.
        unsafe {
            page.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &callback)
        };
        pump(|| slot.borrow().is_some(), "for a snapshot").ok()?;
        let rep = slot.borrow_mut().take().flatten();
        rep
    }

    fn footprint(&self) -> Option<u64> {
        super::page_footprint(&self.view)
    }

    fn cpu_ns(&self) -> Option<u64> {
        process_cpu_ns(&self.view)
    }

    fn user_scripts(&self) -> usize {
        let view = super::native_webview(&self.view);
        // SAFETY: main-thread property reads on a live view; objc2 retains
        // the configuration, controller and the script array.
        unsafe {
            view.configuration()
                .userContentController()
                .userScripts()
                .count()
        }
    }
}

thread_local! {
    static ENABLED: Cell<bool> = const { Cell::new(true) };
}

// As in the app, an address with no site (about:blank) never gets the script.
fn enabled_and_admitted(sensitive: &Cell<bool>, target: &str) -> bool {
    ENABLED.with(Cell::get)
        && target.starts_with("http")
        && !(sensitive.get() && target.contains("/sensitive"))
}

// libc marks the timebase deprecated in favour of another crate; this
// probe needs only the one call.
#[allow(deprecated)]
fn process_cpu_ns(view: &wry::WebView) -> Option<u64> {
    let page = super::native_webview(view);
    // SAFETY: main-thread WebKit access; the SPI is used only when present.
    let supported: bool =
        unsafe { objc2::msg_send![&*page, respondsToSelector: objc2::sel!(_webProcessIdentifier)] };
    if !supported {
        return None;
    }
    // SAFETY: probed above; returns the WebContent process identifier.
    let pid: libc::pid_t = unsafe { objc2::msg_send![&*page, _webProcessIdentifier] };
    if pid <= 0 {
        return None;
    }
    // SAFETY: a correctly sized, zeroed rusage_info_v4 for this flavor.
    let mut info: libc::rusage_info_v4 = unsafe { std::mem::zeroed() };
    // SAFETY: `info` is a live, correctly sized buffer for this flavor.
    let status = unsafe {
        libc::proc_pid_rusage(
            pid,
            libc::RUSAGE_INFO_V4,
            (&mut info as *mut libc::rusage_info_v4).cast(),
        )
    };
    if status != 0 {
        return None;
    }
    let mut timebase = libc::mach_timebase_info { numer: 0, denom: 0 };
    // SAFETY: a live out-parameter for the kernel's fixed timebase.
    if unsafe { libc::mach_timebase_info(&mut timebase) } != 0 || timebase.denom == 0 {
        return None;
    }
    let ticks = info.ri_user_time.saturating_add(info.ri_system_time);
    Some(ticks.saturating_mul(u64::from(timebase.numer)) / u64::from(timebase.denom))
}

fn rgb(rep: &objc2_app_kit::NSBitmapImageRep, x: isize, y: isize) -> Option<(f64, f64, f64)> {
    let color = rep.colorAtX_y(x, y)?;
    let color = color.colorUsingColorSpace(&objc2_app_kit::NSColorSpace::sRGBColorSpace())?;
    Some((
        color.redComponent(),
        color.greenComponent(),
        color.blueComponent(),
    ))
}

/// Samples both frames on a grid: how many points turned warm.
fn compare(
    before: &objc2_app_kit::NSBitmapImageRep,
    after: &objc2_app_kit::NSBitmapImageRep,
) -> usize {
    let (width, height) = (
        before.pixelsWide().min(after.pixelsWide()),
        before.pixelsHigh().min(after.pixelsHigh()),
    );
    let mut tinted = 0;
    for y in (0..height).step_by(3) {
        for x in (0..width).step_by(3) {
            let (Some(a), Some(b)) = (rgb(before, x, y), rgb(after, x, y)) else {
                continue;
            };
            let delta = (a.0 - b.0).abs() + (a.1 - b.1).abs() + (a.2 - b.2).abs();
            if delta < 0.04 {
                continue;
            }
            // Under the quote the mark only adds warmth: blue drops most.
            if b.2 < a.2 && (a.2 - b.2) > (a.0 - b.0).abs() {
                tinted += 1;
            }
        }
    }
    tinted
}

fn epoch_of_old(epoch: u64) -> u64 {
    epoch.saturating_sub(1)
}

fn next_url(fixture: &Fixture) -> String {
    fixture.url("/next")
}

fn check(condition: bool, what: &str) -> Result<(), String> {
    if condition {
        println!("  ok    {what}");
        Ok(())
    } else {
        Err(format!("FAILED {what}"))
    }
}

fn fixtures(mtm: MainThreadMarker, fixture: &Fixture) -> Result<(), String> {
    let probe = Probe::new(mtm, true)?;
    let baseline_scripts = probe.user_scripts();

    println!("fixture: read under page CSP and Trusted Types");
    for path in ["/csp", "/tt", "/strict"] {
        let url = fixture.url(path);
        let epoch = probe.load(&url)?;
        probe.wait_readable()?;
        let (read, took) = probe.read(epoch, &url);
        let read = read.map_err(|f| format!("{path} read failed: {f:?}"))?;
        check(
            read.passages.iter().any(|p| {
                p.text == "The northern rivers rose two metres overnight after the storm."
            }),
            &format!(
                "{path}: instantiated in the private world and read ({} passages, {} ms)",
                read.passages.len(),
                took.as_millis()
            ),
        )?;
    }

    println!("fixture: read shape (public only, verbatim, never secrets)");
    let url = fixture.url("/article");
    let epoch = probe.load(&url)?;
    probe.wait_readable()?;

    let (read, first) = probe.read(epoch, &url);
    let read = read.map_err(|f| format!("article read failed: {f:?}"))?;
    let (_, again) = probe.read(epoch, &url);
    let find = |text: &str| read.passages.iter().find(|p| p.text == text);
    check(
        read.title.as_deref() == Some("Rivers of the North"),
        "title is the native title",
    )?;
    check(
        find("Rivers of the North").is_some_and(|p| p.role == PageRole::Heading(1) && p.verbatim),
        "h1 is a verbatim level-1 heading",
    )?;
    check(
        read.passages.iter().all(|p| {
            !p.text.contains("hunter2") && p.value.as_deref().is_none_or(|v| !v.contains("hunter2"))
        }),
        "the password's value is never read",
    )?;
    check(
        read.passages.iter().all(|p| {
            let leaked = |text: &str| text.contains("4111") || text.contains("928374");
            !leaked(&p.text) && p.value.as_deref().is_none_or(|v| !leaked(v))
        }),
        "card and one-time-code values are never read",
    )?;
    check(
        read.passages
            .iter()
            .any(|p| matches!(p.role, PageRole::Link { same_site: false })),
        "a link off the site is marked as leaving it",
    )?;
    check(
        read.passages.iter().any(|p| p.region == 2),
        "page chrome is marked as region 2",
    )?;
    println!(
        "  first ask {} ms, next read {} ms",
        first.as_millis(),
        again.as_millis()
    );

    println!("fixture: selection recipe");
    let (selection, took) = probe.recipe(epoch, PageRecipe::selection());
    check(
        selection.as_deref() == Some("eastern floodgates at dawn"),
        &format!("selected text read in {} ms", took.as_millis()),
    )?;

    println!("fixture: mark recipe (no find bar)");
    let quote = "The northern rivers rose two metres overnight after the storm.";
    let before = probe.snapshot().ok_or("snapshot before the mark")?;
    let (marked, took) = probe.recipe(epoch, PageRecipe::mark(quote).ok_or("mark")?);
    check(
        marked.as_deref().and_then(mark_outcome) == Some(MarkOutcome::Marked),
        &format!(
            "verbatim quote scrolled to and marked in {} ms",
            took.as_millis()
        ),
    )?;
    settle(Duration::from_millis(150));
    let after = probe.snapshot().ok_or("snapshot after the mark")?;
    let tinted = compare(&before, &after);
    check(
        tinted > 20,
        &format!("the mark paints a warm highlight ({tinted} samples)"),
    )?;
    let (missing, _) = probe.recipe(
        epoch,
        PageRecipe::mark("Not on this page at all").ok_or("mark")?,
    );
    check(
        missing.as_deref().and_then(mark_outcome) == Some(MarkOutcome::Missing),
        "a quote not on the page is reported missing",
    )?;
    let (split, _) = probe.recipe(
        epoch,
        PageRecipe::mark("Engineers opened the eastern floodgates at dawn").ok_or("mark")?,
    );
    check(
        split.as_deref().and_then(mark_outcome) == Some(MarkOutcome::Marked),
        "a quote across inline elements is found",
    )?;

    println!("fixture: outline recipe");
    let (outline, took) = probe.recipe(epoch, PageRecipe::outline());
    let outline = outline
        .as_deref()
        .and_then(parse_outline)
        .ok_or("outline did not parse")?;
    let selectors: Vec<&str> = outline.nodes.iter().map(|n| n.selector.as_str()).collect();
    println!("  outline in {} ms: {selectors:?}", took.as_millis());
    check(
        selectors.contains(&"header.site-head"),
        "header with its stable class",
    )?;
    check(
        selectors
            .iter()
            .all(|s| !s.contains("css-1x2y3z") && !s.contains("kCsWcF")),
        "hashed and generated classes are skipped",
    )?;
    check(selectors.contains(&"div.card"), "repeated cards are found")?;
    check(
        outline.background == Some(crate::page_reader::Rgb(0xfb, 0xfa, 0xf7)) && !outline.dark,
        "page background and lightness",
    )?;
    check(
        outline.fonts.first().map(String::as_str) == Some("Georgia"),
        "page font",
    )?;

    println!("fixture: activation and isolation (page watched throughout)");
    let report_url = format!("{url}#report");
    probe
        .view
        .load_url(&report_url)
        .map_err(|e| format!("report: {e}"))?;
    pump(
        || probe.state.borrow().title.starts_with("report "),
        "for the page's report",
    )?;
    let title = probe.state.borrow().title.clone();
    println!("  page report: {title}");
    check(
        title.contains("active=false"),
        "no user activation from automation",
    )?;
    check(
        title.contains("been=false"),
        "the page never became activated",
    )?;
    check(title.contains("opened=0"), "window.open stayed blocked")?;
    check(probe.state.borrow().popups == 0, "no popup reached native")?;
    check(
        title.contains("leaks=none"),
        "the page saw no private global or handler",
    )?;
    check(title.contains("layout=same"), "marking shifted no layout")?;
    check(
        title.contains("marked=true"),
        "the mark was on the page while it watched",
    )?;
    check(
        !title.contains("zephium"),
        "nothing the page can see names the panel",
    )?;
    check(
        title
            .split_whitespace()
            .find_map(|part| part.strip_prefix("samples="))
            .and_then(|n| n.parse::<u64>().ok())
            .is_some_and(|n| n > 200),
        "the page polled continuously",
    )?;

    println!("fixture: mark cleanup");
    let engineers = "Engineers opened the eastern floodgates at dawn";
    let (_, _) = probe.recipe(epoch, PageRecipe::mark(quote).ok_or("mark")?);
    let (_, _) = probe.recipe(epoch, PageRecipe::mark(engineers).ok_or("mark")?);
    let report = |label: &str| -> Result<String, String> {
        probe
            .view
            .load_url(&format!("{url}#report{label}"))
            .map_err(|e| format!("report: {e}"))?;
        let prefix = format!("report {label} ");
        pump(
            || probe.state.borrow().title.starts_with(&prefix),
            "for a page report",
        )?;
        Ok(probe.state.borrow().title.clone())
    };
    let replaced = report("replaced")?;
    check(
        replaced.contains("sheets=1"),
        "a new mark replaces the old one: one sheet",
    )?;
    settle(Duration::from_millis(5_500));
    let clean = probe.snapshot().ok_or("clean snapshot")?;
    let faded = report("faded")?;
    check(
        faded.contains("sheets=0"),
        "after the fade the page has no sheet of ours",
    )?;
    let (_, _) = probe.recipe(epoch, PageRecipe::mark(engineers).ok_or("mark")?);
    settle(Duration::from_millis(150));
    let marked = probe.snapshot().ok_or("marked snapshot")?;
    check(compare(&clean, &marked) > 20, "a mark paints")?;
    settle(Duration::from_millis(5_500));
    let gone = probe.snapshot().ok_or("faded snapshot")?;
    check(
        compare(&clean, &gone) == 0,
        "and after its fade nothing of it is painted",
    )?;

    println!("fixture: a program that will not start");
    let epoch = probe.load(&url)?;
    probe.wait_readable()?;
    super::browse_reader::probe::break_starts(1);
    let started = Instant::now();
    let (first, _) = probe.read(epoch, &url);
    check(
        first == Err(PageReadFailure::Unavailable) && started.elapsed() < Duration::from_secs(3),
        "the failed start ends that ask as unavailable at once",
    )?;
    probe.wait_readable()?;
    check(
        probe.read(epoch, &url).0.is_ok(),
        "the next ask retries once and reads",
    )?;
    let epoch = probe.load(&url)?;
    probe.wait_readable()?;
    super::browse_reader::probe::break_starts(2);
    let (first, _) = probe.read(epoch, &url);
    settle(Duration::from_millis(200));
    let started = Instant::now();
    let (second, _) = probe.read(epoch, &url);
    let (third, _) = probe.read(epoch, &url);
    check(
        first == Err(PageReadFailure::Unavailable)
            && second == Err(PageReadFailure::Unavailable)
            && third == Err(PageReadFailure::Unavailable)
            && started.elapsed() < Duration::from_secs(3),
        "after the one retry fails the page reads as unavailable, with no loop",
    )?;
    check(
        crate::page_reader::readable(probe.tab),
        "and it never reads as loading",
    )?;
    super::browse_reader::probe::break_starts(0);
    let epoch = probe.load(&url)?;
    probe.wait_readable()?;

    println!("fixture: idle stop and restart");
    if let Some(reader) = probe.reader.borrow().as_ref() {
        reader.stop_now();
    }
    probe.wait_readable()?;
    let (restarted, took) = probe.read(epoch, &url);
    if let Err(failure) = &restarted {
        println!("  restart read failed: {failure:?}");
    }
    check(
        restarted.is_ok_and(|r| r.passages.iter().any(|p| p.text == quote)),
        &format!(
            "after an idle stop the same document reads again without reinstalling ({} ms)",
            took.as_millis()
        ),
    )?;

    println!("fixture: epoch binding");
    let next = fixture.url("/next");
    let old = epoch;
    let new = probe.load(&next)?;
    probe.wait_readable()?;
    check(new != old, "a new document has a new epoch")?;
    let (stale, _) = probe.read(old, &url);
    check(
        stale == Err(PageReadFailure::PageChanged),
        "a read for the old document is discarded",
    )?;
    let (fresh, _) = probe.read(new, &next);
    check(
        fresh
            .is_ok_and(|r| r.epoch == new && r.passages.iter().any(|p| p.text == "The next story")),
        "the new document reads under its own epoch",
    )?;
    let reloaded = probe.load(&next)?;
    probe.wait_readable()?;
    check(
        reloaded != new,
        "a reload of the same address is a new epoch",
    )?;
    check(
        probe.user_scripts() == baseline_scripts + 1,
        "one reader script per view, however many navigations",
    )?;

    println!("fixture: steps on the person's own tab");
    let inputs: Arc<Mutex<Vec<ItemId>>> = Arc::default();
    let seen = inputs.clone();
    crate::host::page_reader::set_policy_for_probe(Some(crate::page_reader::PageReaderPolicy {
        sensitive: Arc::new(|_| false),
        human_input: Arc::new(move |tab| seen.lock().unwrap_or_else(|p| p.into_inner()).push(tab)),
    }));
    let form = fixture.url("/form");
    let epoch = probe.load(&form)?;
    probe.wait_readable()?;
    let (read, _) = probe.read(epoch, &form);
    let read = read.map_err(|f| format!("form read: {f:?}"))?;
    let stored = crate::page_reader::planned_read(probe.tab, read.read).ok_or("stored read")?;
    let passage = |text: &str| {
        read.passages
            .iter()
            .find(|p| p.text == text)
            .and_then(|p| stored.reference(p.id))
            .ok_or_else(|| {
                format!(
                    "no passage {text:?} in {:?}",
                    read.passages.iter().map(|p| &p.text).collect::<Vec<_>>()
                )
            })
    };
    let proposal = |intent, effect, verification| {
        zephium_agentic::SemanticActionProposal::try_new(
            intent,
            effect,
            zephium_agentic::SemanticWaitCondition::Immediate,
            verification,
            zephium_agentic::SemanticSettleBudget::try_new(2_000).expect("settle"),
        )
        .expect("proposal")
    };
    let typed = zephium_agentic::SemanticActionText::try_new("Ada Lovelace".to_owned())
        .map_err(|_| "text")?;
    let started = Instant::now();
    let filled = probe.act(
        epoch,
        read.read,
        &form,
        proposal(
            zephium_agentic::SemanticActionIntent::Fill {
                target: passage("Name")?,
                value: typed,
            },
            zephium_agentic::SemanticEffectClass::LocalWrite,
            zephium_agentic::SemanticVerification::TargetValueMatchesInput,
        ),
    );
    check(
        filled.is_ok(),
        &format!(
            "typing into an ordinary field works ({filled:?}, {} ms)",
            started.elapsed().as_millis()
        ),
    )?;
    let (after, _) = probe.read(epoch, &form);
    let after = after.map_err(|f| format!("form read: {f:?}"))?;
    check(
        after
            .passages
            .iter()
            .any(|p| p.text == "state:Ada Lovelace"),
        "a controlled field's own state took the typed text",
    )?;
    let stored = crate::page_reader::planned_read(probe.tab, after.read).ok_or("stored read")?;
    let password = stored
        .observation()
        .frames()
        .first()
        .and_then(|frame| {
            frame
                .nodes()
                .iter()
                .find(|node| node.role() == zephium_agentic::SemanticRole::Password)
                .map(|node| node.reference())
        })
        .ok_or("password node")?;
    let secret =
        zephium_agentic::SemanticActionText::try_new("hunter2".to_owned()).map_err(|_| "text")?;
    let refused = probe.act(
        epoch,
        after.read,
        &form,
        proposal(
            zephium_agentic::SemanticActionIntent::Fill {
                target: password,
                value: secret,
            },
            zephium_agentic::SemanticEffectClass::LocalWrite,
            zephium_agentic::SemanticVerification::TargetValueMatchesInput,
        ),
    );
    check(
        matches!(
            refused,
            Err(crate::page_reader::PageActFailure::Refused
                | crate::page_reader::PageActFailure::Unsuitable)
        ),
        &format!("a password field is never typed into ({refused:?})"),
    )?;
    // Planned on the first read although a later one was taken since.
    let ordered = probe.act(
        epoch,
        read.read,
        &form,
        proposal(
            zephium_agentic::SemanticActionIntent::Click {
                target: passage("Place order")?,
            },
            zephium_agentic::SemanticEffectClass::Purchase,
            zephium_agentic::SemanticVerification::PageChanged,
        ),
    );
    let (after, _) = probe.read(epoch, &form);
    check(
        ordered.is_ok() && after.is_ok_and(|r| r.passages.iter().any(|p| p.text == "ordered")),
        "a confirmed committing click runs once, as the page's own click",
    )?;
    let stale = probe.act(
        epoch_of_old(epoch),
        read.read,
        &form,
        proposal(
            zephium_agentic::SemanticActionIntent::Click {
                target: passage("Next story")?,
            },
            zephium_agentic::SemanticEffectClass::Read,
            zephium_agentic::SemanticVerification::PageChanged,
        ),
    );
    check(
        stale == Err(crate::page_reader::PageActFailure::PageChanged),
        "a step on another epoch is refused",
    )?;
    inputs.lock().unwrap_or_else(|p| p.into_inner()).clear();
    probe.press_key();
    let reported = || {
        if let Some(reader) = probe.reader.borrow().as_ref() {
            reader.poll();
        }
        inputs
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .contains(&probe.tab)
    };
    pump(reported, "for the person's key to be noticed")?;
    check(
        true,
        "the person's own input on a held tab is reported, so steps pause",
    )?;
    // A step admitted before a navigation never runs after it.
    let (read, _) = probe.read(epoch, &form);
    let read = read.map_err(|f| format!("form read: {f:?}"))?;
    let stored = crate::page_reader::planned_read(probe.tab, read.read).ok_or("stored read")?;
    let target = |text: &str| {
        read.passages
            .iter()
            .find(|p| p.text == text)
            .and_then(|p| stored.reference(p.id))
            .ok_or("passage")
    };
    let slow = Arc::new(Mutex::new(None));
    let second = Arc::new(Mutex::new(None));
    if let Some(reader) = probe.reader.borrow().as_ref() {
        let slot = slow.clone();
        reader.act(
            epoch,
            read.read,
            form.clone(),
            proposal(
                zephium_agentic::SemanticActionIntent::Click {
                    target: target("Check stock")?,
                },
                zephium_agentic::SemanticEffectClass::LocalWrite,
                zephium_agentic::SemanticVerification::PageChanged,
            ),
            Box::new(move |result| *slot.lock().unwrap_or_else(|p| p.into_inner()) = Some(result)),
        );
        let slot = second.clone();
        reader.act(
            epoch,
            read.read,
            form.clone(),
            proposal(
                zephium_agentic::SemanticActionIntent::Click {
                    target: target("Place order")?,
                },
                zephium_agentic::SemanticEffectClass::Purchase,
                zephium_agentic::SemanticVerification::PageChanged,
            ),
            Box::new(move |result| *slot.lock().unwrap_or_else(|p| p.into_inner()) = Some(result)),
        );
    }
    let _ = probe.navigation.begin(&next_url(fixture));
    probe
        .view
        .load_url(&next_url(fixture))
        .map_err(|e| e.to_string())?;
    pump(
        || {
            if let Some(reader) = probe.reader.borrow().as_ref() {
                reader.pump();
            }
            second.lock().unwrap_or_else(|p| p.into_inner()).is_some()
        },
        "for the queued step",
    )?;
    let second = second.lock().unwrap_or_else(|p| p.into_inner()).take();
    check(
        second == Some(Err(crate::page_reader::PageActFailure::PageChanged)),
        &format!("a navigation mid-plan ends the next step as a changed page ({second:?})"),
    )?;
    crate::host::page_reader::set_policy_for_probe(None);
    let _ = slow;

    println!("fixture: back-forward cache");
    let a = fixture.url("/cache-a");
    let b = fixture.url("/cache-b");
    let epoch_a = probe.load(&a)?;
    probe.wait_readable()?;
    check(
        probe
            .read(epoch_a, &a)
            .0
            .is_ok_and(|r| r.passages.iter().any(|p| p.text.contains("Alpha"))),
        "page A reads",
    )?;
    let epoch_b = probe.load(&b)?;
    probe.wait_readable()?;
    let before = probe.state.borrow().finished;
    probe.history(false);
    pump(
        || probe.state.borrow().title == "A restored",
        "for page A to come back from the cache",
    )?;
    pump(
        || probe.state.borrow().finished > before,
        "for the restore to finish",
    )?;
    let restored = probe.epoch().ok_or("restored epoch")?;
    check(
        restored != epoch_a && restored != epoch_b,
        "a restored page has its own epoch",
    )?;
    let (stale, _) = probe.read(epoch_b, &b);
    check(
        stale == Err(PageReadFailure::PageChanged),
        "a read for the page left is discarded",
    )?;
    pump(
        || crate::page_reader::readable(probe.tab),
        "for the restored page to pull again",
    )?;
    let (back, _) = probe.read(restored, &a);
    check(
        back.as_ref().is_ok_and(|r| {
            r.epoch == restored
                && r.passages.iter().any(|p| p.text.contains("Alpha"))
                && !r.passages.iter().any(|p| p.text.contains("Beta"))
        }),
        &format!("the restored page reads itself under its new epoch ({back:?})"),
    )?;
    let before = probe.state.borrow().finished;
    probe.history(true);
    pump(
        || probe.state.borrow().title == "B restored",
        "for page B to come back",
    )?;
    pump(
        || probe.state.borrow().finished > before,
        "for the forward restore to finish",
    )?;
    let forward = probe.epoch().ok_or("forward epoch")?;
    pump(
        || crate::page_reader::readable(probe.tab),
        "for page B to pull again",
    )?;
    check(
        probe.read(forward, &b).0.is_ok_and(|r| {
            r.passages.iter().any(|p| p.text.contains("Beta"))
                && !r.passages.iter().any(|p| p.text.contains("Alpha"))
        }),
        "a page restored before it was ever read reads itself",
    )?;

    println!("fixture: discarded tab restored");
    let epoch = probe.load(&url)?;
    probe.wait_readable()?;
    let _ = probe.read(epoch, &url);
    let saved = probe.interaction_state().ok_or("interaction state")?;
    let restored = Probe::new(mtm, true)?;
    let before = restored.state.borrow().finished;
    let _ = restored.navigation.begin(&url);
    restored.restore(&saved);
    pump(
        || restored.state.borrow().finished > before,
        "for the restored tab to load",
    )?;
    restored.wait_readable()?;
    let epoch = restored.epoch().ok_or("restored tab epoch")?;
    check(
        restored
            .read(epoch, &url)
            .0
            .is_ok_and(|r| r.passages.iter().any(|p| p.text == quote)),
        "a restored tab reads under its new epoch",
    )?;
    drop(restored);

    println!("fixture: warm spare adopted");
    let spare = Probe::new(mtm, true)?;
    let before = spare.state.borrow().finished;
    let _ = spare.navigation.begin("about:blank");
    spare
        .view
        .load_url("about:blank")
        .map_err(|e| e.to_string())?;
    pump(
        || spare.state.borrow().finished > before,
        "for the spare's blank page",
    )?;
    check(
        !crate::page_reader::readable(spare.tab),
        "a blank spare has no script",
    )?;
    let adopted = ItemId::generate();
    spare.tab_cell.set(adopted);
    let epoch = spare.load(&url)?;
    pump(
        || crate::page_reader::readable(adopted),
        "for the adopted tab to pull",
    )?;
    check(
        crate::page_reader::committed_epoch(adopted) == Some(epoch),
        "the adopted tab publishes its own epoch",
    )?;
    check(
        spare
            .read(epoch, &url)
            .0
            .is_ok_and(|r| r.passages.iter().any(|p| p.text == quote)),
        "and reads",
    )?;
    drop(spare);

    println!("fixture: sensitive site and AI off");
    probe.sensitive.set(true);
    let sensitive = fixture.url("/sensitive");
    let epoch = probe.load(&sensitive)?;
    settle(Duration::from_millis(300));
    check(
        !crate::page_reader::readable(probe.tab),
        "a sensitive site gets no script",
    )?;
    let (refused, _) = probe.read(epoch, &sensitive);
    check(
        refused == Err(PageReadFailure::NotReady),
        "and cannot be read",
    )?;
    probe.sensitive.set(false);
    let epoch = probe.load(&url)?;
    probe.wait_readable()?;
    let (_, _) = probe.read(epoch, &url);
    ENABLED.with(|enabled| enabled.set(false));
    if let Some(reader) = probe.reader.borrow().as_ref() {
        reader.set_enabled(false);
    }
    check(
        probe.user_scripts() == baseline_scripts,
        "AI off removes every reader script",
    )?;
    let (off, _) = probe.read(epoch, &url);
    check(off.is_err(), "AI off: nothing reads")?;
    let epoch = probe.load(&url)?;
    settle(Duration::from_millis(300));
    check(
        !crate::page_reader::readable(probe.tab),
        "AI off: new documents get no script",
    )?;
    let _ = epoch;
    ENABLED.with(|enabled| enabled.set(true));
    if let Some(reader) = probe.reader.borrow().as_ref() {
        reader.set_enabled(true);
    }
    let epoch = probe.load(&url)?;
    probe.wait_readable()?;
    check(
        probe.read(epoch, &url).0.is_ok(),
        "AI on again: the next document reads",
    )?;

    println!("fixture: tab close");
    drop(probe.reader.borrow_mut().take());
    check(
        probe.user_scripts() == baseline_scripts,
        "closing removes every reader script",
    )?;
    check(
        !crate::page_reader::readable(probe.tab),
        "and forgets the tab",
    )?;
    Ok(())
}

impl Probe {
    /// A pointer event at a point of the page's viewport, as the person's
    /// mouse would deliver it.
    fn mouse(&self, kind: objc2_app_kit::NSEventType, x: f64, y: f64) {
        let page = super::native_webview(&self.view);
        let pressure = if kind == objc2_app_kit::NSEventType::LeftMouseDown {
            1.0
        } else {
            0.0
        };
        let event = objc2_app_kit::NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
            kind,
            NSPoint::new(x, 768.0 - y),
            objc2_app_kit::NSEventModifierFlags::empty(),
            0.0,
            self._window.windowNumber(),
            None,
            0,
            1,
            pressure,
        );
        let Some(event) = event else {
            return;
        };
        match kind {
            objc2_app_kit::NSEventType::LeftMouseDown => page.mouseDown(&event),
            objc2_app_kit::NSEventType::LeftMouseUp => page.mouseUp(&event),
            _ => page.mouseMoved(&event),
        }
    }

    fn click_at(&self, x: f64, y: f64) {
        self.mouse(objc2_app_kit::NSEventType::LeftMouseDown, x, y);
        settle(Duration::from_millis(30));
        self.mouse(objc2_app_kit::NSEventType::LeftMouseUp, x, y);
        settle(Duration::from_millis(60));
    }

    /// Presses, widens `ups` times with arrow up, then releases: a headless
    /// window gets no pointer moves, so the press is what locates the target.
    fn press_walk_release(&self, x: f64, y: f64, ups: usize) {
        self.mouse(objc2_app_kit::NSEventType::LeftMouseDown, x, y);
        settle(Duration::from_millis(30));
        for _ in 0..ups {
            self.key(126, "\u{f700}");
        }
        self.mouse(objc2_app_kit::NSEventType::LeftMouseUp, x, y);
        settle(Duration::from_millis(60));
    }

    /// One rendering update, as a shown window gets every frame: frame
    /// callbacks and resize observers run.
    fn render(&self) {
        let _ = self.snapshot();
    }

    /// A key as the person's keyboard would press it.
    fn key(&self, code: u16, characters: &str) {
        let page = super::native_webview(&self.view);
        let characters = objc2_foundation::NSString::from_str(characters);
        for kind in [
            objc2_app_kit::NSEventType::KeyDown,
            objc2_app_kit::NSEventType::KeyUp,
        ] {
            let event = objc2_app_kit::NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                kind,
                NSPoint::new(10.0, 10.0),
                objc2_app_kit::NSEventModifierFlags::empty(),
                0.0,
                self._window.windowNumber(),
                None,
                &characters,
                &characters,
                false,
                code,
            );
            if let Some(event) = event {
                if kind == objc2_app_kit::NSEventType::KeyDown {
                    page.keyDown(&event);
                } else {
                    page.keyUp(&event);
                }
            }
        }
        settle(Duration::from_millis(40));
    }

    /// The Assistant fixtures' report: `verb` first, then the page's view.
    fn assist_report(
        &self,
        url: &str,
        verb: &str,
        label: &str,
        arg: &str,
    ) -> Result<String, String> {
        self.view
            .load_url(&format!("{url}#{verb}~{label}~{arg}"))
            .map_err(|e| format!("report: {e}"))?;
        let prefix = format!("assist {label} ");
        pump(
            || self.state.borrow().title.starts_with(&prefix),
            "for a Assistant report",
        )?;
        Ok(self.state.borrow().title.clone())
    }

    fn overlay(&self, epoch: u64) -> Result<serde_json::Value, String> {
        let (answer, _) = self.recipe(epoch, PageRecipe::overlay());
        serde_json::from_str(&answer.ok_or("no overlay answer")?)
            .map_err(|e| format!("overlay state: {e}"))
    }

    fn marks(
        &self,
        epoch: u64,
        read: u64,
        marks: &[crate::page_reader::PageMark],
        reduce_motion: bool,
    ) -> (Vec<u8>, Duration) {
        let Some((recipe, targets)) =
            crate::host::page_reader::marks_recipe(self.tab, epoch, read, marks, reduce_motion)
        else {
            return (Vec::new(), Duration::ZERO);
        };
        let (answer, took) = self.recipe(epoch, recipe);
        (
            answer
                .map(|answer| crate::platform::page_recipe::placed_marks(&answer, &targets))
                .unwrap_or_default(),
            took,
        )
    }

    /// Polls pick `pick` until it ends or `limit` passes.
    fn pick_outcome(
        &self,
        epoch: u64,
        pick: u64,
        limit: Duration,
    ) -> Option<crate::platform::page_recipe::PickState> {
        let end = Instant::now() + limit;
        loop {
            let (answer, _) = self.recipe(epoch, PageRecipe::picked());
            let state = answer
                .as_deref()
                .and_then(|answer| crate::platform::page_recipe::pick_state(answer, pick));
            match state {
                Some(crate::platform::page_recipe::PickState::Waiting) if Instant::now() < end => {
                    settle(Duration::from_millis(60));
                }
                other => return other,
            }
        }
    }
}

/// The value after `key=` in a page report.
fn field<'a>(report: &'a str, key: &str) -> &'a str {
    report
        .split_whitespace()
        .find_map(|part| part.strip_prefix(&format!("{key}=")))
        .unwrap_or("")
}

/// The page's own geometry of the items a report asked for.
fn items(report: &str) -> HashMap<String, [i64; 4]> {
    let json = report.split_once("items=").map_or("{}", |(_, json)| json);
    serde_json::from_str::<HashMap<String, Option<[i64; 4]>>>(json)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(id, rect)| rect.map(|rect| (id, rect)))
        .collect()
}

fn mark_box(state: &serde_json::Value, n: u64) -> Option<[i64; 4]> {
    let mark = state["m"].as_array()?.iter().find(|m| m["n"] == n)?;
    let b = mark["b"].as_array()?;
    Some([
        b[0].as_i64()?,
        b[1].as_i64()?,
        b[2].as_i64()?,
        b[3].as_i64()?,
    ])
}

/// A mark's box is its item's box with the fixed padding, to a pixel.
fn encloses(mark: Option<[i64; 4]>, item: Option<&[i64; 4]>) -> bool {
    match (mark, item) {
        (Some(m), Some(i)) => {
            (m[0] - (i[0] - 4)).abs() <= 1
                && (m[1] - (i[1] - 4)).abs() <= 1
                && (m[2] - (i[2] + 8)).abs() <= 1
                && (m[3] - (i[3] + 8)).abs() <= 1
        }
        _ => false,
    }
}

fn assist(mtm: MainThreadMarker, fixture: &Fixture) -> Result<(), String> {
    use crate::page_reader::PageMark;
    use crate::platform::page_recipe::PickState;
    let probe = Probe::new(mtm, true)?;

    println!("assist: link targets in reads");
    let url = fixture.url("/listing");
    let epoch = probe.load(&url)?;
    probe.wait_readable()?;
    let (read, _) = probe.read(epoch, &url);
    let read = read.map_err(|f| format!("listing read failed: {f:?}"))?;
    let passage = |text: &str| read.passages.iter().find(|p| p.text == text);
    let id = |text: &str| {
        passage(text)
            .map(|p| p.id)
            .ok_or_else(|| format!("no passage {text:?}"))
    };
    check(
        passage("Story number 1 about rivers").and_then(|p| p.href.as_deref())
            == Some("https://example.org/story/1"),
        "a story link carries its absolute destination",
    )?;
    let comments = fixture.url("/item?id=3");
    check(
        passage("3 comments").and_then(|p| p.href.as_deref()) == Some(comments.as_str()),
        "a relative link resolves, its query kept",
    )?;
    check(
        passage("Signed link").is_some_and(|p| p.href.is_none()),
        "a destination with user information is withheld",
    )?;
    check(
        passage("Mail link").is_some_and(|p| p.href.is_none()),
        "a mailto link carries none",
    )?;
    check(
        read.passages.iter().filter(|p| p.href.is_some()).all(|p| {
            matches!(p.role, PageRole::Link { .. })
                && p.href
                    .as_deref()
                    .is_some_and(|h| h.starts_with("http") && h.len() <= 2_048)
        }),
        &format!(
            "only links carry one ({} of {} passages)",
            read.passages.iter().filter(|p| p.href.is_some()).count(),
            read.passages.len()
        ),
    )?;
    let last = (1..=30)
        .rev()
        .find(|n| passage(&format!("Story number {n} about rivers")).is_some())
        .ok_or("no story read")?;

    println!("assist: numbered marks enclose listing items");
    let before = probe.assist_report(&url, "r", "before", "")?;
    let marks = [
        PageMark {
            n: 1,
            passage: id("Story number 1 about rivers")?,
        },
        PageMark {
            n: 2,
            passage: id("Story number 2 about rivers")?,
        },
        PageMark {
            n: 3,
            passage: id("3 comments")?,
        },
        PageMark {
            n: 4,
            passage: id(&format!("Story number {last} about rivers"))?,
        },
    ];
    let (placed, took) = probe.marks(epoch, read.read, &marks, false);
    check(
        placed == [1, 2, 3, 4],
        &format!("four marks placed in {} ms ({placed:?})", took.as_millis()),
    )?;
    let state = probe.overlay(epoch)?;
    let rows = probe.assist_report(&url, "r", "rows", &format!("1,2,3,{last}"))?;
    let geometry = items(&rows);
    for (n, row) in [
        (1, "1".to_owned()),
        (2, "2".to_owned()),
        (3, "3".to_owned()),
        (4, last.to_string()),
    ] {
        check(
            encloses(mark_box(&state, n), geometry.get(&row)),
            &format!(
                "mark {n} encloses story {row}'s item row and subtext row ({:?} around {:?})",
                mark_box(&state, n),
                geometry.get(&row)
            ),
        )?;
    }
    check(
        state["m"]
            .as_array()
            .is_some_and(|m| m.iter().all(|m| m["i"] == false && m["k"] == "17 17 17")),
        "badges sit in the left gutter, in dark ink on a light page",
    )?;
    check(
        field(&rows, "attrs") == "0" && field(&rows, "inside") == "0",
        "the page saw no attribute, style or node change in its own elements",
    )?;
    check(
        field(&rows, "html").parse::<usize>().ok()
            == field(&before, "html").parse::<usize>().ok().map(|n| n + 1),
        &format!(
            "one layer of ours, beside the body ({})",
            field(&rows, "added")
        ),
    )?;
    check(
        !rows.to_ascii_lowercase().contains("zephium") && !rows.contains("assist-"),
        "nothing the page can see names the panel",
    )?;

    println!("assist: document scroll runs none of our script");
    // The first frame delivers the observers' initial sizes.
    probe.render();
    let layouts = probe.overlay(epoch)?["l"].as_u64().unwrap_or(0);
    let cpu = probe.cpu_ns();
    for (step, y) in [600, 1_400, 300, 2_000, 0, 2_600].into_iter().enumerate() {
        probe.assist_report(&url, "s", &format!("scroll{step}"), &y.to_string())?;
        probe.render();
    }
    let scrolled_cpu = probe.cpu_ns().zip(cpu).map_or(0.0, |(after, before)| {
        after.saturating_sub(before) as f64 / 1e6
    });
    let after_scroll = probe.overlay(epoch)?;
    check(
        after_scroll["l"].as_u64() == Some(layouts),
        &format!("six document scrolls, no layout of ours ({layouts} layouts before and after; page CPU {scrolled_cpu:.1} ms)"),
    )?;
    let at = probe.assist_report(&url, "r", "atbottom", "")?;
    let scroll_y = field(&at, "scroll").parse::<f64>().unwrap_or(0.0);
    let snapshot = probe.snapshot().ok_or("snapshot after scrolling")?;
    let scale = snapshot.pixelsWide() as f64 / 1024.0;
    let badge = mark_box(&after_scroll, 4).ok_or("mark 4")?;
    let (bx, by) = (
        badge[0] as f64 - 22.5 - 7.0,
        badge[1] as f64 + badge[3] as f64 / 2.0 - scroll_y,
    );
    let pixel = rgb(&snapshot, (bx * scale) as isize, (by * scale) as isize);
    check(
        by > 0.0 && by < 768.0 && pixel.is_some_and(|(r, g, b)| r < 0.3 && g < 0.3 && b < 0.3),
        &format!("the badge scrolled with its row on its own (pixel {pixel:?} at {bx:.0},{by:.0})"),
    )?;

    println!("assist: focus and clearing");
    let (focused, _) = probe.recipe(epoch, PageRecipe::mark_focus(Some(2), true));
    let state = probe.overlay(epoch)?;
    check(
        focused.as_deref() == Some("1") && state["f"] == 2,
        "mark 2 is emphasised",
    )?;
    let (cleared, _) = probe.recipe(epoch, PageRecipe::marks(&[], false).ok_or("clear")?);
    settle(Duration::from_millis(300));
    let state = probe.overlay(epoch)?;
    check(
        cleared.as_deref() == Some("M:")
            && state["h"] == false
            && state["o"] == 0
            && state["s"] == 0,
        "clearing removes the layer and every observer and listener",
    )?;
    let after_clear = probe.assist_report(&url, "r", "cleared", "")?;
    check(
        field(&after_clear, "html") == field(&before, "html"),
        "the page is back to its own nodes",
    )?;

    println!("assist: costs");
    let mut times = Vec::new();
    for _ in 0..7 {
        let (placed, took) = probe.marks(epoch, read.read, &marks, true);
        if placed.len() == 4 {
            times.push(took.as_secs_f64() * 1e3);
        }
    }
    let twelve: Vec<PageMark> = (1..=12)
        .filter_map(|n| {
            id(&format!("Story number {n} about rivers"))
                .ok()
                .map(|passage| PageMark { n, passage })
        })
        .collect();
    let mut twelve_times = Vec::new();
    for _ in 0..7 {
        let (placed, took) = probe.marks(epoch, read.read, &twelve, true);
        if placed.len() == 12 {
            twelve_times.push(took.as_secs_f64() * 1e3);
        }
    }
    check(
        times.len() == 7 && twelve_times.len() == 7,
        &format!(
            "placement on the listing: 4 marks median {:.1} ms, 12 marks median {:.1} ms (round trip)",
            median(&mut times),
            median(&mut twelve_times)
        ),
    )?;
    let _ = probe.recipe(epoch, PageRecipe::clear());

    let heavy = fixture.url("/heavy");
    let heavy_epoch = probe.load(&heavy)?;
    probe.wait_readable()?;
    let (heavy_read, _) = probe.read(heavy_epoch, &heavy);
    let heavy_read = heavy_read.map_err(|f| format!("heavy read: {f:?}"))?;
    probe.settled_footprint();
    let base = probe.settled_footprint();
    let paragraphs: Vec<PageMark> = heavy_read
        .passages
        .iter()
        .filter(|p| p.role == PageRole::Text)
        .step_by(7)
        .take(12)
        .zip(1..)
        .map(|(p, n)| PageMark { n, passage: p.id })
        .collect();
    let (placed, took) = probe.marks(heavy_epoch, heavy_read.read, &paragraphs, false);
    probe.render();
    let marked = probe.settled_footprint();
    check(
        placed.len() == 12,
        &format!(
            "12 marks on a 3,000-paragraph page in {} ms; page footprint {base} KB before, {marked} KB with them ({:+} KB)",
            took.as_millis(),
            i64::try_from(marked).unwrap_or(0) - i64::try_from(base).unwrap_or(0)
        ),
    )?;
    let state = probe.overlay(heavy_epoch)?;
    check(
        state["o"].as_u64() == Some(13) && state["s"] == 0,
        "twelve marked elements and the document observed, no scroll listener",
    )?;

    println!("assist: a card feed and a nested scroller");
    let feed = fixture.url("/feed");
    let feed_epoch = probe.load(&feed)?;
    probe.wait_readable()?;
    let (feed_read, _) = probe.read(feed_epoch, &feed);
    let feed_read = feed_read.map_err(|f| format!("feed read: {f:?}"))?;
    let feed_id = |text: &str| {
        feed_read
            .passages
            .iter()
            .find(|p| p.text == text)
            .map(|p| p.id)
            .ok_or_else(|| format!("no feed passage {text:?}"))
    };
    let (placed, _) = probe.marks(
        feed_epoch,
        feed_read.read,
        &[
            PageMark {
                n: 1,
                passage: feed_id("Card title 1")?,
            },
            PageMark {
                n: 2,
                passage: feed_id("Read post 5")?,
            },
            PageMark {
                n: 3,
                passage: feed_id("Scrolled row 3")?,
            },
        ],
        false,
    );
    let state = probe.overlay(feed_epoch)?;
    let cards = items(&probe.assist_report(&feed, "r", "cards", "card1,card5,row3")?);
    check(placed == [1, 2, 3], "three marks placed on the feed")?;
    check(
        encloses(mark_box(&state, 1), cards.get("card1"))
            && encloses(mark_box(&state, 2), cards.get("card5")),
        "a heading and a link each mark their whole card",
    )?;
    check(
        encloses(mark_box(&state, 3), cards.get("row3")),
        "a row inside a scroller marks its row",
    )?;
    check(
        state["m"]
            .as_array()
            .is_some_and(|m| m.iter().all(|m| m["k"] == "255 255 255")),
        "light ink on a dark page",
    )?;
    check(
        state["s"] == 1,
        "one scroll listener, on the scroller holding a mark",
    )?;
    probe.render();
    let layouts = probe.overlay(feed_epoch)?["l"].as_u64().unwrap_or(0);
    let row = mark_box(&state, 3).ok_or("row mark")?;
    probe.assist_report(&feed, "i", "inner", "56")?;
    probe.render();
    settle(Duration::from_millis(60));
    let state = probe.overlay(feed_epoch)?;
    let moved = mark_box(&state, 3).ok_or("row mark after scroll")?;
    check(
        state["l"].as_u64().is_some_and(|l| l > layouts) && (row[1] - moved[1] - 56).abs() <= 1,
        &format!(
            "scrolling the scroller moves its mark with it ({} to {})",
            row[1], moved[1]
        ),
    )?;

    println!("assist: navigation removes the marks");
    let state = probe.overlay(feed_epoch)?;
    let card = mark_box(&state, 1).ok_or("card mark")?;
    let badge = (card[0] as f64 - 29.5, card[1] as f64 + card[3] as f64 / 2.0);
    let shown = probe.snapshot().ok_or("snapshot with marks")?;
    let scale = shown.pixelsWide() as f64 / 1024.0;
    let at = |rep: &objc2_app_kit::NSBitmapImageRep| {
        rgb(rep, (badge.0 * scale) as isize, (badge.1 * scale) as isize)
    };
    let slow = fixture.url("/slow");
    let _ = probe.navigation.begin(&slow);
    probe
        .view
        .load_url(&slow)
        .map_err(|e| format!("slow: {e}"))?;
    settle(Duration::from_millis(400));
    let leaving = probe.snapshot().ok_or("snapshot while leaving")?;
    check(
        crate::page_reader::committed_epoch(probe.tab) == Some(feed_epoch)
            && at(&shown).is_some_and(|(r, _, _)| r > 0.8)
            && at(&leaving).is_some_and(|(r, _, _)| r < 0.3),
        &format!(
            "a navigation's start removes them while the old page still shows ({:?} then {:?})",
            at(&shown),
            at(&leaving)
        ),
    )?;
    pump(|| probe.epoch() != Some(feed_epoch), "for the slow page")?;

    println!("assist: the person's pick");
    let epoch = probe.load(&url)?;
    probe.wait_readable()?;
    let (started, took) = probe.recipe(epoch, PageRecipe::pick(1, false).ok_or("pick")?);
    let state = probe.overlay(epoch)?;
    check(
        started.as_deref() == Some("1") && state["w"] == true,
        &format!("the picker starts in {} ms", took.as_millis()),
    )?;
    let geometry = items(&probe.assist_report(&url, "r", "picking", "t2,t3,t4,t5,email,f")?);
    let centre = |id: &str| -> Result<(f64, f64), String> {
        let rect = geometry
            .get(id)
            .ok_or_else(|| format!("no rect for {id}"))?;
        Ok((rect[0] as f64 + 12.0, rect[1] as f64 + rect[3] as f64 / 2.0))
    };
    let (x, y) = centre("t2")?;
    probe.click_at(x, y);
    let outcome = probe.pick_outcome(epoch, 1, Duration::from_secs(3));
    let synthetic = matches!(outcome, Some(PickState::Picked(_)));
    if let Some(PickState::Picked(picked)) = &outcome {
        check(
            picked.label == "Link"
                && picked.text == "Story number 2 about rivers"
                && picked.selector.as_deref() == Some("[id=\"t2\"]"),
            &format!("a click picks the link under the pointer ({picked:?})"),
        )?;
    } else {
        println!("  note  synthetic pointer input did not reach the picker ({outcome:?})");
    }
    if synthetic {
        let _ = probe.recipe(epoch, PageRecipe::pick(2, false).ok_or("pick")?);
        let (x, y) = centre("t3")?;
        probe.press_walk_release(x, y, 5);
        match probe.pick_outcome(epoch, 2, Duration::from_secs(3)) {
            Some(PickState::Picked(picked)) => check(
                picked.label == "Story list"
                    && picked.text.contains("Story number 1 about rivers")
                    && picked.text.contains("\n")
                    && picked.selector.as_deref() == Some("[id=\"hnmain\"]"),
                &format!(
                    "arrow up widens to the listing, named for its rows ({:?}, {} chars)",
                    picked.label,
                    picked.text.chars().count()
                ),
            )?,
            other => return Err(format!("FAILED widened pick: {other:?}")),
        }
        let _ = probe.recipe(epoch, PageRecipe::pick(3, false).ok_or("pick")?);
        let (x, y) = centre("email")?;
        let scrolled =
            probe.assist_report(&url, "s", "toform", &format!("{}", (y - 300.0).max(0.0)))?;
        let offset = field(&scrolled, "scroll").parse::<f64>().unwrap_or(0.0);
        probe.press_walk_release(x, y - offset, 1);
        match probe.pick_outcome(epoch, 3, Duration::from_secs(3)) {
            Some(PickState::Picked(picked)) => check(
                picked.text.contains("Email address")
                    && picked.text.contains("Password")
                    && !["person@example.com", "hunter2", "draft text", "Opt A"]
                        .iter()
                        .any(|value| picked.text.contains(value)),
                &format!("a form's text never carries its values ({:?})", picked.text),
            )?,
            other => return Err(format!("FAILED form pick: {other:?}")),
        }
        let _ = probe.recipe(epoch, PageRecipe::pick(4, false).ok_or("pick")?);
        probe.assist_report(&url, "s", "totop", "0")?;
        let (x, y) = centre("t4")?;
        probe.click_at(x, y);
        let _ = probe.pick_outcome(epoch, 4, Duration::from_secs(3));
        let state = probe.overlay(epoch)?;
        let attached: Vec<&str> = state["p"]
            .as_array()
            .map(|p| p.iter().filter_map(|p| p["p"].as_str()).collect())
            .unwrap_or_default();
        check(
            attached == ["2", "3", "4"],
            &format!("at most three picks stay attached, the oldest goes ({attached:?})"),
        )?;
        let (again, _) = probe.recipe(epoch, PageRecipe::pick_read(2).ok_or("read")?);
        check(
            matches!(
                again.as_deref().and_then(|a| crate::platform::page_recipe::pick_state(a, 2)),
                Some(PickState::Picked(ref p)) if p.label == "Story list"
            ),
            "a pick reads again as it is now",
        )?;
        let (gone, _) = probe.recipe(epoch, PageRecipe::pick_read(1).ok_or("read")?);
        check(
            gone.as_deref() == Some("N"),
            "a pick no longer attached reads as gone",
        )?;
        let _ = probe.recipe(epoch, PageRecipe::pick_clear(3).ok_or("clear")?);
        settle(Duration::from_millis(250));
        let state = probe.overlay(epoch)?;
        check(
            state["p"].as_array().is_some_and(|p| p.len() == 2),
            "clearing a pick removes its outline",
        )?;
        let watched = probe.assist_report(&url, "r", "picked", "")?;
        println!("  page report: {watched}");
        check(
            field(&watched, "clicks") == "0"
                && field(&watched, "downs") == "0"
                && field(&watched, "keys") == "0",
            "the page never received the presses, clicks or keys of picking",
        )?;
        check(
            field(&watched, "attrs") == "0" && field(&watched, "inside") == "0",
            "and nothing of its own changed",
        )?;
        check(field(&watched, "opened") == "0", "no popup got through")?;
        println!(
            "  note  page activation after the person's own clicks: active={} been={}",
            field(&watched, "active"),
            field(&watched, "been")
        );
        let _ = probe.recipe(epoch, PageRecipe::pick(5, false).ok_or("pick")?);
        probe.key(53, "\u{1b}");
        check(
            probe.pick_outcome(epoch, 5, Duration::from_secs(2)) == Some(PickState::Cancelled),
            "Escape ends a pick as cancelled",
        )?;
    }
    let _ = probe.recipe(epoch, PageRecipe::pick(6, false).ok_or("pick")?);
    let _ = probe.recipe(epoch, PageRecipe::pick_cancel());
    check(
        probe.pick_outcome(epoch, 6, Duration::from_secs(2)) == Some(PickState::Cancelled),
        "a cancel ends a pick as cancelled",
    )?;
    let quiet = probe.assist_report(&url, "r", "quiet", "")?;
    if !synthetic {
        check(
            field(&quiet, "active") == "false" && field(&quiet, "been") == "false",
            "starting and ending pickers gave the page no activation",
        )?;
    }

    println!("assist: under script-src 'self'");
    let csp = fixture.url("/listing-csp");
    let epoch = probe.load(&csp)?;
    probe.wait_readable()?;
    let (read, _) = probe.read(epoch, &csp);
    let read = read.map_err(|f| format!("csp read: {f:?}"))?;
    let first = read
        .passages
        .iter()
        .find(|p| p.text == "Story number 1 about rivers")
        .ok_or("csp story")?;
    let (placed, _) = probe.marks(
        epoch,
        read.read,
        &[PageMark {
            n: 1,
            passage: first.id,
        }],
        false,
    );
    let (started, _) = probe.recipe(epoch, PageRecipe::pick(7, false).ok_or("pick")?);
    let watched = probe.assist_report(&csp, "r", "csp", "")?;
    check(
        placed == [1] && started.as_deref() == Some("1"),
        "marks and the picker work under the page's CSP",
    )?;
    check(
        field(&watched, "active") == "false"
            && field(&watched, "been") == "false"
            && field(&watched, "opened") == "0",
        "and give the page no activation",
    )?;
    Ok(())
}

/// Unnamed fields read under the best name the page gives, and Return in a
/// search field submits its form.
fn fields(mtm: MainThreadMarker, fixture: &Fixture) -> Result<(), String> {
    use crate::page_reader::{PageFieldKind, PageReaderPolicy};
    let probe = Probe::new(mtm, true)?;
    crate::host::page_reader::set_policy_for_probe(Some(PageReaderPolicy {
        sensitive: Arc::new(|_| false),
        human_input: Arc::new(|_| {}),
    }));
    println!("fields: unnamed fields read");
    let url = fixture.url("/hn");
    let epoch = probe.load(&url)?;
    probe.wait_readable()?;
    let (read, took) = probe.read(epoch, &url);
    let read = read.map_err(|f| format!("hn read failed: {f:?}"))?;
    let controls: Vec<(PageRole, &str)> = read
        .passages
        .iter()
        .filter(|p| {
            matches!(
                p.role,
                PageRole::Field(_) | PageRole::Select | PageRole::Checkbox { .. }
            )
        })
        .map(|p| (p.role, p.text.as_str()))
        .collect();
    check(
        controls
            == [
                (PageRole::Field(PageFieldKind::Text), "Search"),
                (PageRole::Field(PageFieldKind::Text), "shipping notes"),
                (PageRole::Field(PageFieldKind::Text), "Promo code"),
                (PageRole::Select, "sort order"),
                (PageRole::Checkbox { checked: false }, "Keep me posted"),
                (PageRole::Field(PageFieldKind::Text), ""),
            ],
        &format!(
            "every enabled field reads: the words beside it, its description, its form name, or nothing ({controls:?}, {} ms)",
            took.as_millis()
        ),
    )?;
    let stored = crate::page_reader::planned_read(probe.tab, read.read).ok_or("stored read")?;
    check(
        read.passages
            .iter()
            .all(|p| stored.reference(p.id).is_some()),
        "each passage resolves to its node",
    )?;
    let search = read
        .passages
        .iter()
        .find(|p| p.text == "Search")
        .and_then(|p| stored.reference(p.id))
        .ok_or("no search passage")?;
    let proposal = |intent, effect, verification| {
        zephium_agentic::SemanticActionProposal::try_new(
            intent,
            effect,
            zephium_agentic::SemanticWaitCondition::Immediate,
            verification,
            zephium_agentic::SemanticSettleBudget::try_new(2_000).expect("settle"),
        )
        .expect("proposal")
    };
    let typed =
        zephium_agentic::SemanticActionText::try_new("Terax".to_owned()).map_err(|_| "text")?;
    let filled = probe.act(
        epoch,
        read.read,
        &url,
        proposal(
            zephium_agentic::SemanticActionIntent::Fill {
                target: search,
                value: typed,
            },
            zephium_agentic::SemanticEffectClass::LocalWrite,
            zephium_agentic::SemanticVerification::TargetValueMatchesInput,
        ),
    );
    check(
        filled.is_ok(),
        &format!("a Fill step resolves on the unnamed search field ({filled:?})"),
    )?;
    let (after, _) = probe.read(epoch, &url);
    let after = after.map_err(|f| format!("hn read failed: {f:?}"))?;
    check(
        after
            .passages
            .iter()
            .any(|p| p.text == "Search" && p.value.as_deref() == Some("Terax")),
        "the field holds the typed words",
    )?;
    println!("fields: Return submits a Return-only form");
    let stored = crate::page_reader::planned_read(probe.tab, after.read).ok_or("stored read")?;
    let search = after
        .passages
        .iter()
        .find(|p| p.text == "Search")
        .and_then(|p| stored.reference(p.id))
        .ok_or("no search passage")?;
    let finished = probe.state.borrow().finished;
    let pressed = probe.act(
        epoch,
        after.read,
        &url,
        proposal(
            zephium_agentic::SemanticActionIntent::Press {
                target: search,
                key: zephium_agentic::SemanticPressKey::Enter,
            },
            zephium_agentic::SemanticEffectClass::Read,
            zephium_agentic::SemanticVerification::PageChanged,
        ),
    );
    check(
        pressed.is_ok(),
        &format!("Return runs as the runtime's fixed press recipe and takes ({pressed:?})"),
    )?;
    pump(
        || probe.state.borrow().finished > finished,
        "for the search results",
    )?;
    let results = fixture.url("/search?q=Terax");
    probe.wait_readable()?;
    let next = probe.epoch().ok_or("no committed epoch")?;
    let (landed, _) = probe.read(next, &results);
    check(
        next != epoch
            && landed.is_ok_and(|r| r.passages.iter().any(|p| p.text == "Results for Terax")),
        "the form navigated to its action with the query",
    )?;
    check(probe.state.borrow().popups == 0, "no popup reached native")?;
    crate::host::page_reader::set_policy_for_probe(None);
    Ok(())
}

fn editors(mtm: MainThreadMarker, fixture: &Fixture) -> Result<(), String> {
    use crate::page_reader::{PageFieldKind, PagePassage, PageReaderPolicy};
    use zephium_agentic::{
        SemanticActionIntent as Intent, SemanticActionText, SemanticEffectClass as Effect,
        SemanticPressKey, SemanticVerification as Verify,
    };
    let probe = Probe::new(mtm, true)?;
    crate::host::page_reader::set_policy_for_probe(Some(PageReaderPolicy {
        sensitive: Arc::new(|_| false),
        human_input: Arc::new(|_| {}),
    }));
    let url = fixture.url("/notion");
    let report = |label: &str| -> Result<String, String> {
        probe
            .view
            .load_url(&format!("{url}#report-{label}"))
            .map_err(|e| format!("report: {e}"))?;
        let prefix = format!("notion {label} ");
        pump(
            || probe.state.borrow().title.starts_with(&prefix),
            "for the editor's report",
        )?;
        Ok(probe.state.borrow().title.clone())
    };
    let proposal = |intent, effect, verification| {
        zephium_agentic::SemanticActionProposal::try_new(
            intent,
            effect,
            zephium_agentic::SemanticWaitCondition::Immediate,
            verification,
            zephium_agentic::SemanticSettleBudget::try_new(2_000).expect("settle"),
        )
        .expect("proposal")
    };
    let epoch = probe.load(&url)?;
    probe.wait_readable()?;
    let read_now = || {
        probe
            .read(epoch, &url)
            .0
            .map_err(|f| format!("editor read failed: {f:?}"))
    };
    let editable = |read: &PageReadout| -> Vec<(String, Option<String>)> {
        read.passages
            .iter()
            .filter(|p| p.role == PageRole::Field(PageFieldKind::Text))
            .map(|p| (p.text.clone(), p.value.clone()))
            .collect()
    };
    let target = |read: &PageReadout, name: &str| {
        let stored = crate::page_reader::planned_read(probe.tab, read.read).ok_or("stored read")?;
        read.passages
            .iter()
            .find(|p| p.role == PageRole::Field(PageFieldKind::Text) && p.text == name)
            .and_then(|p: &PagePassage| stored.reference(p.id))
            .ok_or_else(|| format!("no field named {name:?}"))
    };
    let fill = |read: &PageReadout, name: &str, text: &str| -> Result<(), String> {
        let value = SemanticActionText::try_new(text.to_owned()).map_err(|_| "text")?;
        probe
            .act(
                epoch,
                read.read,
                &url,
                proposal(
                    Intent::Fill {
                        target: target(read, name)?,
                        value,
                    },
                    Effect::LocalWrite,
                    Verify::TargetValueMatchesInput,
                ),
            )
            .map_err(|f| format!("fill {name:?}: {f:?}"))
    };
    let enter = |read: &PageReadout, name: &str| -> Result<(), String> {
        probe
            .act(
                epoch,
                read.read,
                &url,
                proposal(
                    Intent::Press {
                        target: target(read, name)?,
                        key: SemanticPressKey::Enter,
                    },
                    Effect::LocalWrite,
                    Verify::PageChanged,
                ),
            )
            .map_err(|f| format!("Return in {name:?}: {f:?}"))
    };

    println!("editors: editable regions read as fields");
    let first = read_now()?;
    let none = |name: &str| (name.to_owned(), None);
    check(
        editable(&first)
            == [
                none("New page"),
                none("Press '/' for commands"),
                none("Leave a comment…"),
            ],
        &format!(
            "the title, the empty body block and the comment box read as text fields, named by their placeholders, in order ({:?})",
            editable(&first)
        ),
    )?;
    let role_of = |read: &PageReadout, text: &str| {
        read.passages
            .iter()
            .find(|p| p.text == text)
            .map(|p| p.role)
    };
    check(
        role_of(&first, "Ask AI") == Some(PageRole::Button)
            && role_of(&first, "Templates") == Some(PageRole::Button)
            && role_of(&first, "Get started with").is_none_or(|role| role == PageRole::Text),
        "the start row stays buttons and words",
    )?;

    println!("editors: title, Return, body");
    fill(&first, "New page", "Weekly notes")?;
    enter(&first, "New page")?;
    let moved = report("moved")?;
    check(
        field(&moved, "focus") == "body" && field(&moved, "title") == "Weekly+notes",
        &format!("Return in the title moves the caret into the body ({moved})"),
    )?;
    let ready = read_now()?;
    check(
        editable(&ready).contains(&("New page".to_owned(), Some("Weekly notes".to_owned()))),
        &format!("the title holds the typed words ({:?})", editable(&ready)),
    )?;
    fill(&ready, "Press '/' for commands", "First item")?;
    let written = report("written")?;
    check(
        field(&written, "body") == "First+item" && field(&written, "title") == "Weekly+notes",
        &format!("the body holds its words and the title kept its own ({written})"),
    )?;
    enter(&ready, "Press '/' for commands")?;
    let next = report("next")?;
    check(
        field(&next, "focus") == "next" && field(&next, "blocks") == "2",
        &format!(
            "Return in an editor that takes the browser's paragraph starts its next block ({next})"
        ),
    )?;

    println!("editors: Return the page leaves to the browser");
    let before = read_now()?;
    fill(&before, "Leave a comment…", "Looks good")?;
    enter(&before, "Leave a comment…")?;
    let split = report("split")?;
    let after = read_now()?;
    check(
        editable(&after).contains(&("Leave a comment…".to_owned(), Some("Looks good".to_owned()))),
        &format!(
            "the comment box keeps its name once its placeholder is gone ({:?})",
            editable(&after)
        ),
    )?;
    check(
        field(&split, "comment") == "Looks+good|_",
        &format!("Return in a rich editor starts a new paragraph ({split})"),
    )?;
    check(
        field(&split, "active") == "false"
            && field(&split, "been") == "false"
            && field(&split, "opened") == "0"
            && field(&split, "clicks") == "0",
        &format!("nothing gained activation ({split})"),
    )?;
    check(probe.state.borrow().popups == 0, "no popup reached native")?;
    crate::host::page_reader::set_policy_for_probe(None);
    Ok(())
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.total_cmp(b));
    values.get(values.len() / 2).copied().unwrap_or(0.0)
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

impl Probe {
    /// Collects garbage in the page's process (measurement only, through
    /// WebKit's testing SPI when present) and reports its footprint in KB.
    fn settled_footprint(&self) -> u64 {
        let page = super::native_webview(&self.view);
        // SAFETY: main-thread WebKit access; the SPI is probed first.
        unsafe {
            let configuration = page.configuration();
            let pool: Retained<objc2::runtime::NSObject> =
                objc2::msg_send![&*configuration, processPool];
            let supported: bool = objc2::msg_send![
                &*pool,
                respondsToSelector: objc2::sel!(_garbageCollectJavaScriptObjectsForTesting)
            ];
            if supported {
                let _: () = objc2::msg_send![&*pool, _garbageCollectJavaScriptObjectsForTesting];
            }
        }
        settle(Duration::from_millis(700));
        self.footprint().unwrap_or(0) / 1024
    }
}

fn ask_costs(probe: &Probe, url: &str, label: &str) -> Result<(), String> {
    let epoch = probe.load(url)?;
    probe.wait_readable()?;
    settle(Duration::from_millis(300));
    let base = probe.settled_footprint();
    let cpu = probe.cpu_ns();
    let (first, first_took) = probe.read(epoch, url);
    let first_cpu = probe.cpu_ns().zip(cpu).map_or(0.0, |(after, before)| {
        after.saturating_sub(before) as f64 / 1e6
    });
    let first = first.map_err(|f| format!("{label} first read: {f:?}"))?;
    let after_first = probe.settled_footprint();
    let mut reads = Vec::new();
    let mut cpus = Vec::new();
    for _ in 0..10 {
        let cpu = probe.cpu_ns();
        let (read, took) = probe.read(epoch, url);
        read.map_err(|f| format!("{label} read: {f:?}"))?;
        reads.push(took.as_secs_f64() * 1e3);
        cpus.push(probe.cpu_ns().zip(cpu).map_or(0.0, |(after, before)| {
            after.saturating_sub(before) as f64 / 1e6
        }));
    }
    let after_reads = probe.settled_footprint();
    let (_, selection) = probe.recipe(epoch, PageRecipe::selection());
    let (_, outline) = probe.recipe(epoch, PageRecipe::outline());
    let (_, mark) = probe.recipe(
        epoch,
        PageRecipe::mark("Paragraph 7 of section 150").ok_or("mark")?,
    );
    println!(
        "  {label}: first ask {} ms (page CPU {:.1} ms, {} passages); later reads median {:.1} ms (page CPU median {:.1} ms)",
        first_took.as_millis(),
        first_cpu,
        first.passages.len(),
        median(&mut reads),
        median(&mut cpus)
    );
    println!(
        "  {label}: page footprint {base} KB before asking, {after_first} KB after the first ask (+{} KB), {after_reads} KB after 10 more reads (+{} KB)",
        after_first.saturating_sub(base),
        after_reads.saturating_sub(base)
    );
    println!(
        "  {label}: selection {} ms, outline {} ms, mark {} ms",
        selection.as_millis(),
        outline.as_millis(),
        mark.as_millis()
    );
    Ok(())
}

fn measure(mtm: MainThreadMarker, fixture: &Fixture, article: Option<&str>) -> Result<(), String> {
    println!("measure: bootstrap cost per page load (A/B, alternating, 40 loads each)");
    let with = Probe::new(mtm, true)?;
    let without = Probe::new(mtm, false)?;
    for path in ["/plain", "/heavy"] {
        let url = fixture.url(path);
        for _ in 0..3 {
            with.load(&url)?;
            without.load(&url)?;
        }
        let mut samples: HashMap<bool, (Vec<f64>, Vec<f64>)> = HashMap::new();
        for _ in 0..40 {
            for (probe, enabled) in [(&with, true), (&without, false)] {
                let cpu = probe.cpu_ns();
                let started = Instant::now();
                probe.load(&url)?;
                let wall = started.elapsed().as_secs_f64() * 1e3;
                let cpu = probe.cpu_ns().zip(cpu).map_or(0.0, |(after, before)| {
                    after.saturating_sub(before) as f64 / 1e6
                });
                let entry = samples.entry(enabled).or_default();
                entry.0.push(wall);
                entry.1.push(cpu);
            }
        }
        for enabled in [true, false] {
            let (mut wall, mut cpu) = samples.remove(&enabled).unwrap_or_default();
            println!(
                "  {path:<7} reader={:<5} load median {:.2} ms; page-process CPU per load median {:.2} ms, mean {:.2} ms",
                enabled,
                median(&mut wall),
                median(&mut cpu.clone()),
                mean(&cpu)
            );
            cpu.clear();
        }
        settle(Duration::from_millis(300));
        println!(
            "  {path:<7} settled page footprint: reader {} KB, no reader {} KB",
            with.settled_footprint(),
            without.settled_footprint()
        );
    }
    drop(without);

    println!("measure: page memory in one process, reader on and off in alternating blocks");
    let heavy = fixture.url("/heavy");
    let mut blocks: HashMap<bool, Vec<u64>> = HashMap::new();
    for _ in 0..3 {
        for enabled in [true, false] {
            ENABLED.with(|on| on.set(enabled));
            if let Some(reader) = with.reader.borrow().as_ref() {
                reader.set_enabled(enabled);
            }
            for _ in 0..12 {
                with.load(&heavy)?;
            }
            blocks
                .entry(enabled)
                .or_default()
                .push(with.settled_footprint());
        }
    }
    ENABLED.with(|on| on.set(true));
    if let Some(reader) = with.reader.borrow().as_ref() {
        reader.set_enabled(true);
    }
    for enabled in [true, false] {
        println!(
            "  reader={enabled:<5} settled footprint after each 12-load block: {:?} KB",
            blocks.get(&enabled).cloned().unwrap_or_default()
        );
    }

    println!("measure: memory once the person leaves a page they asked about");
    let plain = fixture.url("/plain");
    with.load(&plain)?;
    let before = with.settled_footprint();
    let epoch = with.load(&heavy)?;
    with.wait_readable()?;
    for _ in 0..5 {
        let _ = with.read(epoch, &heavy);
    }
    let asked = with.settled_footprint();
    with.load(&plain)?;
    let left = with.settled_footprint();
    println!(
        "  on /plain {before} KB; on /heavy after 5 reads {asked} KB; back on /plain {left} KB ({:+} KB)",
        i64::try_from(left).unwrap_or(0) - i64::try_from(before).unwrap_or(0)
    );

    println!("measure: first ask, reads and memory");
    ask_costs(&with, &fixture.url("/plain"), "/plain")?;
    ask_costs(&with, &fixture.url("/heavy"), "/heavy")?;
    if let Some(article) = article {
        ask_costs(&with, article, "live article")?;
    }
    Ok(())
}

pub(crate) fn run(arguments: &[String]) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("the probe must run on the main thread")?;
    let app = NSApplication::sharedApplication(mtm);
    let _ = app.setActivationPolicy(NSApplicationActivationPolicy::Prohibited);
    let fixture = Fixture::start()?;
    let measuring = arguments.iter().any(|a| a == "--measure");
    let assist_only = arguments.iter().any(|a| a == "--assist");
    let fields_only = arguments.iter().any(|a| a == "--fields");
    let glow_only = arguments.iter().any(|a| a == "--glow");
    let editors_only = arguments.iter().any(|a| a == "--editors");
    let wikipedia = arguments
        .iter()
        .position(|a| a == "--article")
        .and_then(|i| arguments.get(i + 1))
        .map(String::as_str);
    let outcome = objc2::rc::autoreleasepool(|_| {
        if measuring {
            measure(mtm, &fixture, wikipedia)
        } else if assist_only {
            assist(mtm, &fixture)
        } else if fields_only {
            fields(mtm, &fixture)
        } else if glow_only {
            page_glow_probe::run(mtm, &fixture)
        } else if editors_only {
            editors(mtm, &fixture)
        } else {
            fixtures(mtm, &fixture)
                .and_then(|()| assist(mtm, &fixture))
                .and_then(|()| fields(mtm, &fixture))
                .and_then(|()| editors(mtm, &fixture))
                .and_then(|()| page_glow_probe::run(mtm, &fixture))
        }
    });
    drop(fixture);
    outcome
}
