//! Loopback replicas of the rich editors people write in: Slack's composer
//! (a controlled Quill-like editor with Enter to send and a mention popup),
//! Linear's new-issue dialog (ProseMirror-like title and description, a team
//! picker that opens on pointer down like Radix menus) and a Notion page of
//! blocks that saves as it is typed. Like the real editors, each keeps its
//! own model: it takes edits that come through the browser's editing
//! (beforeinput/input), and puts back any DOM change that did not, so a raw
//! textContent write never reaches what is sent. Each commit posts its text
//! in the address so the probe can read exactly what was written.

/// The replica served at a path, if any.
pub(super) fn editor(path: &str) -> Option<&'static str> {
    match path {
        "/edit/slack" | "/edit/slack-enter" => Some(SLACK),
        "/edit/linear" => Some(LINEAR),
        "/edit/notion" => Some(NOTION),
        "/edit/webmail"
        | "/edit/webmail-swap"
        | "/edit/webmail-autosave"
        | "/edit/webmail-inbox"
        | "/edit/webmail-blocks"
        | "/edit/webmail-thread" => Some(WEBMAIL),
        _ => None,
    }
}

/// The text a commit posted, decoded from its address.
pub(super) fn posted(path: &str) -> Option<String> {
    let query = path.split_once("?text=")?.1;
    let mut out = Vec::new();
    let bytes = query.as_bytes();
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'%' if at + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[at + 1..at + 3]).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                at += 3;
            }
            b'+' => {
                out.push(b' ');
                at += 1;
            }
            byte => {
                out.push(byte);
                at += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// A controlled editor shared by the replicas: `mount(host, onChange)` keeps a
/// model of paragraphs, applies beforeinput/input edits from the browser's
/// editing, and re-renders over any other change.
const EDITOR: &str = r#"<script>
function mount(host, onChange){
  var model=[''], rendering=false;
  function text(){ return model.join('\n'); }
  function render(caret){
    rendering=true;
    host.innerHTML='';
    model.forEach(function(line){ var p=document.createElement('p'); if(line) p.textContent=line; else p.appendChild(document.createElement('br')); host.appendChild(p); });
    if(caret!==false && document.activeElement===host){ var r=document.createRange(); r.selectNodeContents(host.lastChild); r.collapse(false); var s=getSelection(); s.removeAllRanges(); s.addRange(r); }
    rendering=false; onChange(text());
  }
  function fromDom(){
    var lines=[];
    function read(node){
      if(node.nodeType===3) return node.data;
      if(node.nodeName==='BR') return '\n';
      var value=''; for(var j=0;j<node.childNodes.length;j++) value+=read(node.childNodes[j]);
      return value;
    }
    for(var i=0;i<host.childNodes.length;i++){
      var c=host.childNodes[i]; if(c.nodeType!==1||c.tagName!=='P') return null;
      // Chromium's Shift+Enter uses BRs within a paragraph. A final BR is
      // its caret placeholder; preceding BRs are real line breaks.
      var value=read(c); if(c.lastChild&&c.lastChild.nodeName==='BR') value=value.slice(0,-1);
      lines.push(value.replace(/ /g,' '));
    }
    return lines.length?lines:[''];
  }
  host.addEventListener('input', function(){
    var lines=fromDom();
    if(lines===null){ render(); return; }
    model=lines; onChange(text());
  });
  new MutationObserver(function(){
    if(rendering) return;
    // Editing through the browser keeps the paragraphs; a raw write does not.
    if(fromDom()===null) render(false);
  }).observe(host,{childList:true,subtree:true,characterData:true});
  render(false);
  return { text:text, clear:function(){ model=['']; render(); } };
}
// An editor with no model of its own, like a mail composer's body: the
// browser's editing leaves a block per line (an empty line as <div><br></div>)
// and the text is read back from what is rendered.
function plain(host, onChange){
  var inserts=0;
  host.addEventListener('beforeinput', function(e){ if(e.inputType==='insertText') inserts++; });
  host.addEventListener('input', function(){ onChange(); });
  return { inserts:function(){ return inserts; }, text:function(){ return host.innerText.replace(/ /g,' ').replace(/\n+$/,''); } };
}
</script>"#;

const SLACK: &str = concat!(
    r#"<!doctype html><html><head><meta charset="utf-8"><title>design (Channel) - Acme - Slack</title></head><body>
<div role="tablist" aria-label="Workspace"><button role="tab" aria-label="Home" aria-selected="true">Home</button><button role="tab" aria-label="DMs">DMs</button><button role="tab" aria-label="Activity">Activity</button></div>
<nav aria-label="Channels and direct messages"><div role="tree"><div role="treeitem" aria-selected="false">general</div><div role="treeitem" aria-selected="true">design</div></div></nav>
<main>
<h1>design</h1>
<div id="list" role="list" aria-label="design (channel)">
<div role="listitem"><button>Person A</button> <a href="/archives/C01/p1" aria-label="Today at 9:14:02 AM">9:14 AM</a> <div>Mockups for the new onboarding are in the file</div></div>
</div>
<div role="group" aria-label="composer">
<div id="ed" class="ql-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message to design"></div>
<div id="mentions" role="listbox" aria-label="People" hidden><div role="option" id="m1">Person A</div><div role="option" id="m2">Person B</div></div>
<button id="send" aria-label="Send now" disabled>Send</button>
</div>
</main>"#,
    r#"<script>
var list=document.getElementById('list'), sendButton=document.getElementById('send'), popup=document.getElementById('mentions'), ed=document.getElementById('ed');
"#,
    r#"</script>"#,
    "__EDITOR__",
    r#"<script>
var editor=mount(ed,function(t){ sendButton.disabled=!t.trim(); var open=/(^|\s)@\w*$/.test(t); popup.hidden=!open; });
function send(){
  var t=editor.text().trim(); if(!t) return;
  fetch('/edit/slack/send?text='+encodeURIComponent(t),{method:'POST'});
  var row=document.createElement('div'); row.setAttribute('role','listitem');
  row.innerHTML='<button>You</button> <a href="/archives/C01/p2" aria-label="Today at 10:00:00 AM">10:00 AM</a> <div></div>';
  row.lastChild.textContent=t; list.appendChild(row); editor.clear();
}
ed.addEventListener('keydown',function(e){
  if(e.key!=='Enter'||e.shiftKey) return;
  e.preventDefault();
  if(!popup.hidden){ popup.hidden=true; return; }
  send();
});
sendButton.addEventListener('click',send);
</script></body></html>"#
);

const LINEAR: &str = concat!(
    r#"<!doctype html><html><head><meta charset="utf-8"><title>My issues › Assigned</title></head><body>
<nav aria-label="Sidebar"><button id="new" aria-label="Create new issue">New issue</button><a href="/edit/linear">Inbox</a><a href="/edit/linear">My issues</a></nav>
<main><h1>My issues</h1><div role="list" id="issues"><a role="listitem" href="/edit/linear">ACM-1 Offline sync loses edits after a conflict</a></div></main>
<div id="dialog" role="dialog" aria-modal="true" aria-label="New issue" hidden>
<h2>New issue</h2>
<button id="team" aria-haspopup="menu" aria-expanded="false">Team: Backlog</button>
<div id="menu" role="menu" hidden><div role="menuitem" data-team="Engineering">Engineering</div><div role="menuitem" data-team="Design">Design</div></div>
<div id="title" contenteditable="true" role="textbox" aria-label="Issue title"></div>
<div id="desc" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Add description…"></div>
<button id="create" disabled>Create issue</button>
</div>"#,
    "__EDITOR__",
    r#"<script>
var dialog=document.getElementById('dialog'), team=document.getElementById('team'), menu=document.getElementById('menu'), create=document.getElementById('create'), chosen='';
document.getElementById('new').addEventListener('click',function(){ dialog.hidden=false; document.getElementById('title').focus(); });
var title=mount(document.getElementById('title'),function(t){ create.disabled=!t.trim(); });
var desc=mount(document.getElementById('desc'),function(){});
// Like Radix menus: the picker opens on pointer down, never on a bare click.
team.addEventListener('pointerdown',function(e){ if(e.button!==0) return; e.preventDefault(); var open=menu.hidden; menu.hidden=!open; team.setAttribute('aria-expanded',String(open)); });
menu.addEventListener('click',function(e){ var item=e.target.closest('[data-team]'); if(!item) return; chosen=item.dataset.team; team.textContent='Team: '+chosen; menu.hidden=true; team.setAttribute('aria-expanded','false'); });
create.addEventListener('click',function(){
  var t=title.text().trim(); if(!t) return;
  var body=t+'|'+desc.text().trim()+'|'+chosen;
  fetch('/edit/linear/issue?text='+encodeURIComponent(body),{method:'POST'});
  dialog.hidden=true;
  var row=document.createElement('a'); row.setAttribute('role','listitem'); row.href='/edit/linear'; row.textContent='ACM-2 '+t;
  document.getElementById('issues').appendChild(row);
});
</script></body></html>"#
);

const NOTION: &str = concat!(
    r#"<!doctype html><html><head><meta charset="utf-8"><title>Launch notes</title></head><body>
<nav aria-label="Sidebar"><a href="/edit/notion">Launch notes</a></nav>
<main><h1>Launch notes</h1>
<div id="blocks" role="group" aria-label="Page content">
<div class="block" contenteditable="true" role="textbox" aria-label="Block 1"></div>
</div>
<div id="saved" role="status">Saved</div>
</main>"#,
    "__EDITOR__",
    r#"<script>
var editors=[], timer=null, status=document.getElementById('saved');
function save(){
  status.textContent='Saving…';
  clearTimeout(timer);
  timer=setTimeout(function(){
    var text=editors.map(function(e){return e.text();}).filter(function(t){return t.trim();}).join('\n');
    fetch('/edit/notion/save?text='+encodeURIComponent(text),{method:'POST'});
    status.textContent='Saved';
  },300);
}
function add(host){
  editors.push(mount(host,save));
  // Enter at the end of a block starts the next block, as Notion does.
  host.addEventListener('keydown',function(e){
    if(e.key!=='Enter'||e.shiftKey) return;
    e.preventDefault();
    var next=document.createElement('div'); next.className='block'; next.contentEditable='true'; next.setAttribute('role','textbox');
    next.setAttribute('aria-label','Block '+(editors.length+1));
    document.getElementById('blocks').appendChild(next); add(next); next.focus();
  });
}
document.querySelectorAll('.block').forEach(add);
</script></body></html>"#
);

/// Gmail's compose: the Compose button moves the address to a fragment that
/// holds state (`#inbox?compose=new`), which loads no document, and opens a
/// dialog with To and Subject inputs, a contenteditable body and Send. The
/// swap variant re-renders Send as an identical new node, as a single-page app
/// does while a confirmation waits. The thread variant opens a newsletter's
/// conversation with its own Reply box and Send beside Compose. The autosave
/// variant saves the draft as Gmail does while a confirmation waits: the
/// fragment takes the draft's id, the box takes the subject as its title.
/// The inbox variant lists more messages than one look holds before the
/// compose box, which floats over them without being modal, closes with
/// "Save & close" and names Send inside direction marks, as Gmail's does.
const WEBMAIL: &str = concat!(
    r#"<!doctype html><html><head><meta charset="utf-8"><title>Inbox - Mail</title></head><body>
<nav aria-label="Mailboxes"><a href="/edit/webmail">Inbox</a></nav>
<main>__THREAD__<h1>Inbox</h1><button id="compose">Compose</button>
<div role="list" aria-label="Messages"><div role="listitem">Dana: Quarterly report</div></div>
<div id="status" role="status"></div></main>
<div id="dialog" role="dialog" aria-modal="true" aria-label="New Message" hidden>
<h2>New Message</h2>
<input id="to" type="text" aria-label="To recipients">
<input id="subject" type="text" aria-label="Subject">
<div id="body" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message Body"></div>
<div id="bar"><button id="send">Send</button></div>
</div>"#,
    "__EDITOR__",
    r#"<script>
var dialog=document.getElementById('dialog'), blocks=location.pathname.indexOf('blocks')>=0;
var body=(blocks ? plain : mount)(document.getElementById('body'),function(){ arm(); });
var swapping=location.pathname.indexOf('swap')>=0, swaps=[];
var autosave=location.pathname.indexOf('autosave')>=0, saves=0, saving=null;
location.hash='inbox';
document.getElementById('compose').addEventListener('click',function(){ location.hash='inbox?compose=new'; dialog.hidden=false; document.getElementById('to').focus(); });
function send(){
  var parts=[document.getElementById('to').value, document.getElementById('subject').value, body.text()];
  // How many times the body was typed into: a retyped field counts again.
  if(blocks) parts.push(body.inserts());
  fetch('/edit/webmail/send?text='+encodeURIComponent(parts.join('|')),{method:'POST'});
  dialog.hidden=true; document.getElementById('status').textContent='Message sent';
}
function rerender(){
  var old=document.getElementById('send'), fresh=old.cloneNode(true);
  fresh.addEventListener('click',send); old.replaceWith(fresh);
}
document.getElementById('send').addEventListener('click',send);
var reply=document.getElementById('reply-send');
if(reply) reply.addEventListener('click',function(){
  fetch('/edit/webmail/reply?text='+encodeURIComponent(document.getElementById('reply').value),{method:'POST'});
  document.getElementById('status').textContent='Reply sent';
});
function arm(){
  if(autosave){
    clearTimeout(saving);
    saving=setTimeout(function(){
      saves++; location.hash='inbox?compose=draft'+saves;
      var title=document.getElementById('subject').value||'New Message';
      dialog.setAttribute('aria-label',title); dialog.querySelector('h2').textContent=title;
      document.getElementById('status').textContent='Draft saved';
    },1500);
  }
  if(!swapping) return;
  swaps.forEach(clearTimeout); swaps=[3500].map(function(ms){ return setTimeout(rerender,ms); });
}
</script></body></html>"#
);

const THREAD: &str = r#"<section role="region" aria-label="Conversation"><h2>Weekly digest</h2>
<p>From: news@sender.test</p>
<textarea id="reply" aria-label="Reply" autofocus></textarea>
<button id="reply-send">Send</button></section>"#;

/// The replica with the shared editor in place.
pub(super) fn page(path: &str) -> Option<String> {
    let page = editor(path).map(|html| html.replace("__EDITOR__", EDITOR))?;
    let page = page.replace(
        "__THREAD__",
        if path == "/edit/webmail-thread" {
            THREAD
        } else {
            ""
        },
    );
    let page = if path == "/edit/webmail-inbox" {
        let rows: String = (1..=120)
            .map(|n| {
                format!(
                    "<div role=\"listitem\" style=\"height:7px;font-size:6px;overflow:hidden\">\
                     <input type=\"checkbox\" aria-label=\"Select\"><a href=\"#m{n}\">Sender {n}</a> \
                     <span>Update {n}</span> <span>Oct {}</span></div>",
                    n % 28 + 1
                )
            })
            .collect();
        page.replace(
            "<div role=\"listitem\">Dana: Quarterly report</div>",
            &format!("<div role=\"listitem\">Dana: Quarterly report</div>{rows}"),
        )
        .replace(
            "<button id=\"send\">Send</button>",
            "<button id=\"send\" aria-label=\"Send \u{202a}(\u{2318}Enter)\u{202c}\">Send</button>",
        )
        .replace(
            "<h2>New Message</h2>",
            "<h2>New Message</h2><button aria-label=\"Save &amp; close\" onclick=\"dialog.hidden=true\">x</button>",
        )
        .replace(
            "role=\"dialog\" aria-modal=\"true\"",
            "role=\"dialog\" style=\"position:fixed;right:8px;bottom:0;width:420px;background:#fff;border:1px solid #888\"",
        )
    } else {
        page
    };
    // A composer that only Enter sends, as Slack's is with its button hidden.
    Some(if path == "/edit/slack-enter" {
        page.replace("<button id=\"send\"", "<button id=\"send\" hidden")
    } else {
        page
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_commit_posts_its_text_in_its_address() {
        assert_eq!(
            super::posted("/edit/slack/send?text=On%20my%20way%20%F0%9F%9A%80").as_deref(),
            Some("On my way 🚀")
        );
        assert_eq!(super::posted("/edit/slack/send"), None);
        for path in [
            "/edit/slack",
            "/edit/linear",
            "/edit/notion",
            "/edit/webmail",
            "/edit/webmail-swap",
            "/edit/webmail-autosave",
            "/edit/webmail-inbox",
            "/edit/webmail-blocks",
            "/edit/webmail-thread",
        ] {
            let page = super::page(path).unwrap();
            assert!(page.contains("function mount") && !page.contains("__EDITOR__"));
        }
    }
}
