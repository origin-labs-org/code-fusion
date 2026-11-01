const DEFAULT_SNAPSHOT_MAX_ELEMENTS = 200;

const DEFAULT_SNAPSHOT_MAX_DOM_NODES = 300;

const SHARED_HELPERS =
  "function safeId(id){return /^[A-Za-z][A-Za-z0-9_-]*$/.test(id);}" +
  "function isHidden(el){try{var st=window.getComputedStyle(el);if(!st)return false;if(st.display==='none'||st.visibility==='hidden'||st.opacity==='0')return true;var r=el.getBoundingClientRect();if(r.width<=0&&r.height<=0)return true;return false;}catch(e){return false;}}" +
  "function accName(el){var n=el.getAttribute('aria-label')||el.getAttribute('alt')||el.getAttribute('title')||el.getAttribute('placeholder')||'';if(!n){n=(el.innerText||el.textContent||'');}n=(n||'').trim();return n.slice(0,120);}" +
  "function semanticName(el,tag){var n=el.getAttribute('aria-label')||el.getAttribute('alt')||el.getAttribute('title')||el.getAttribute('placeholder')||'';if(!n&&/^(a|button|input|textarea|select|summary)$/.test(tag))n=accName(el);return String(n||'').trim().replace(/\\s+/g,' ').slice(0,120);}" +
  "function attrsOf(el){var out={};var keys=['id','href','name','type','placeholder','title','alt','role','aria-label','data-testid','data-test','data-qa'];for(var i=0;i<keys.length;i++){var v=el.getAttribute(keys[i]);if(v!=null&&String(v).trim()!=='')out[keys[i]]=String(v).trim().slice(0,240);}return out;}" +
  "function depthOf(el){if(el===document.body)return 0;var d=0;var p=el.parentElement;while(p&&p!==document.body){d++;p=p.parentElement;}return d;}" +
  "function semanticText(el,tag){if(!/^(h[1-6]|p|li|dt|dd|blockquote|pre|code|caption|th|td|label|summary|button|a|option|legend|figcaption)$/.test(tag))return '';return String(el.innerText||el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,300);}" +
  "function implicitRole(el,tag){if(tag==='a'&&el.getAttribute('href')!=null)return 'link';if(tag==='button')return 'button';if(tag==='select')return 'combobox';if(tag==='textarea')return 'textbox';if(tag==='summary')return 'button';if(tag==='input'){var ty=(el.getAttribute('type')||'text').toLowerCase();if(ty==='checkbox')return 'checkbox';if(ty==='radio')return 'radio';if(ty==='button'||ty==='submit'||ty==='reset')return 'button';if(ty==='search')return 'searchbox';return 'textbox';}return '';}" +
  "function buildSelector(el){if(el.id&&safeId(el.id))return '#'+el.id;var parts=[];var cur=el;var depth=0;while(cur&&cur.nodeType===1&&depth<6){if(cur.id&&safeId(cur.id)){parts.unshift('#'+cur.id);break;}var t=cur.tagName.toLowerCase();var idx=1;var sib=cur.previousElementSibling;while(sib){if(sib.tagName===cur.tagName)idx++;sib=sib.previousElementSibling;}parts.unshift(t+':nth-of-type('+idx+')');cur=cur.parentElement;depth++;}return parts.join(' > ');}" +
  "function xpathOf(el){if(el.id&&safeId(el.id))return '//*[@id=\"' + el.id + '\"]';var parts=[];var cur=el;while(cur&&cur.nodeType===1){var t=cur.tagName.toLowerCase();var idx=1;var sib=cur.previousElementSibling;while(sib){if(sib.tagName===cur.tagName)idx++;sib=sib.previousElementSibling;}parts.unshift(t+'['+idx+']');cur=cur.parentElement;}return '/'+parts.join('/');}" +
  "function inViewportOf(el){try{var r=el.getBoundingClientRect();var w=window.innerWidth||0;var h=window.innerHeight||0;return r.bottom>0&&r.right>0&&r.top<h&&r.left<w;}catch(e){return false;}}" +
  "function describeElement(el,ref){var tag=(el.tagName||'').toLowerCase();var rect=el.getBoundingClientRect();var item={ref:ref,tag:tag,selector:buildSelector(el),xpath:xpathOf(el),rect:{x:Math.round(rect.left),y:Math.round(rect.top),width:Math.round(rect.width),height:Math.round(rect.height)},inViewport:inViewportOf(el)};" +
  "var explicitRole=el.getAttribute&&el.getAttribute('role');if(explicitRole)item.role=explicitRole;else{var role=implicitRole(el,tag);if(role)item.role=role;}" +
  "var name=semanticName(el,tag);if(name)item.name=name;var text=semanticText(el,tag);if(text)item.text=text;" +
  "if(tag==='input'||tag==='textarea'||tag==='select'){var v=el.value;if(typeof v==='string')item.value=v.slice(0,240);}" +
  "if(el.disabled===true)item.disabled=true;" +
  "if(tag==='input'){var ty=(el.getAttribute('type')||'').toLowerCase();if(ty==='checkbox'||ty==='radio')item.checked=el.checked===true;}" +
  "var attrs=attrsOf(el);if(Object.keys(attrs).length>0)item.attributes=attrs;" +
  "return item;}";

export function SNAPSHOT_SCRIPT(maxElements?: number, includeHidden?: boolean): string {
  const max =
    typeof maxElements === "number" && maxElements > 0
      ? Math.floor(maxElements)
      : DEFAULT_SNAPSHOT_MAX_ELEMENTS;
  const hidden = includeHidden === true;
  return (
    "(function(){" +
    "var MAX=" +
    String(max) +
    ";var DOM_MAX=" +
    String(DEFAULT_SNAPSHOT_MAX_DOM_NODES) +
    ";var INCLUDE_HIDDEN=" +
    String(hidden) +
    ";" +
    "var ACTION_SEL='a[href], button, input, textarea, select, [role], [onclick], [tabindex], summary, label, [contenteditable]';" +
    "var DOM_SEL='body, main, nav, header, footer, aside, section, article, h1, h2, h3, h4, h5, h6, p, ul, ol, li, dl, dt, dd, blockquote, pre, code, table, caption, thead, tbody, tfoot, tr, th, td, form, fieldset, legend, figure, figcaption, img, canvas, svg, a[href], button, input, textarea, select, option, summary, label, [role], [aria-label], [contenteditable]';" +
    SHARED_HELPERS +
    "var refs=new Map();var refByEl=new WeakMap();var counter=0;window.__cfRefs=refs;" +
    "function assignRef(el){var existing=refByEl.get(el);if(existing)return existing;counter++;var ref='e'+counter;refByEl.set(el,ref);refs.set(ref,el);return ref;}" +
    "var all=document.querySelectorAll(ACTION_SEL);var elements=[];var truncated=false;" +
    "for(var i=0;i<all.length;i++){if(elements.length>=MAX){truncated=true;break;}var el=all[i];" +
    "if(!INCLUDE_HIDDEN&&isHidden(el))continue;" +
    "elements.push(describeElement(el,assignRef(el)));}" +
    "var dom=[];var domTruncated=false;" +
    "function walk(el,depth){if(!el||el.nodeType!==1)return;if(dom.length>=DOM_MAX){domTruncated=true;return;}" +
    "var tag=(el.tagName||'').toLowerCase();" +
    "var isSemantic=el===document.body||DOM_SEL.split(', ').indexOf(tag)>=0||(el.getAttribute&&(el.getAttribute('role')||el.getAttribute('aria-label')));" +
    "if(isSemantic){" +
    "var node={tag:tag,depth:depth,inViewport:inViewportOf(el)};" +
    "var nodeRef=refByEl.get(el);if(nodeRef)node.ref=nodeRef;" +
    "var nodeRole=el.getAttribute&&el.getAttribute('role');if(nodeRole)node.role=nodeRole;else{var implied=implicitRole(el,tag);if(implied)node.role=implied;}" +
    "var nodeName=semanticName(el,tag);if(nodeName)node.name=nodeName;" +
    "var nodeText=semanticText(el,tag);if(nodeText)node.text=nodeText;" +
    "var nodeAttrs=attrsOf(el);if(Object.keys(nodeAttrs).length>0)node.attributes=nodeAttrs;" +
    "dom.push(node);}" +
    "var children=el.children;for(var j=0;j<children.length;j++)walk(children[j],depth+1);}" +
    "walk(document.body,0);" +
    "return {url:String(location.href||''),title:String(document.title||''),elements:elements,truncated:truncated,dom:dom,domTruncated:domTruncated};" +
    "})()"
  );
}

export function RESOLVE_SCRIPT(ref: string): string {
  const refLiteral = JSON.stringify(ref);
  return (
    "(function(){" +
    "var m=window.__cfRefs;" +
    "var el=m&&m.get(" +
    refLiteral +
    ");" +
    "if(!el)return null;" +
    "el.scrollIntoView({block:'center',inline:'center'});" +
    "var b=el.getBoundingClientRect();" +
    "return {cx:Math.round(b.left+b.width/2),cy:Math.round(b.top+b.height/2)};" +
    "})()"
  );
}

export const VIEWPORT_SCRIPT =
  "(function(){return {scrollX:Math.round(window.scrollX||window.pageXOffset||0),scrollY:Math.round(window.scrollY||window.pageYOffset||0),innerWidth:window.innerWidth||document.documentElement.clientWidth||0,innerHeight:window.innerHeight||document.documentElement.clientHeight||0};})()";

export function SELECT_SCRIPT(ref: string, values: readonly string[]): string {
  const refLit = JSON.stringify(ref);
  const valsLit = JSON.stringify(values);
  return (
    "(function(){" +
    "var m=window.__cfRefs;var el=m&&m.get(" +
    refLit +
    ");" +
    "if(!el)return {error:'ref_not_found'};" +
    "if(!el.tagName||el.tagName.toLowerCase()!=='select')return {error:'not_select'};" +
    "var values=" +
    valsLit +
    ";var matched=false;" +
    "for(var oi=0;oi<el.options.length;oi++){el.options[oi].selected=false;}" +
    "for(var vi=0;vi<values.length;vi++){var want=values[vi];var found=false;" +
    "for(var i=0;i<el.options.length;i++){if(el.options[i].value===want){el.options[i].selected=true;found=true;matched=true;break;}}" +
    "if(!found){for(var j=0;j<el.options.length;j++){if((el.options[j].text||'').trim()===String(want).trim()){el.options[j].selected=true;found=true;matched=true;break;}}}" +
    "}" +
    "if(!matched)return {error:'no_match'};" +
    "el.dispatchEvent(new Event('input',{bubbles:true}));" +
    "el.dispatchEvent(new Event('change',{bubbles:true}));" +
    "return {ok:true};" +
    "})()"
  );
}

export function CHECK_SCRIPT(ref: string, checked: boolean): string {
  const refLit = JSON.stringify(ref);
  const wantLit = checked ? "true" : "false";
  return (
    "(function(){" +
    "var m=window.__cfRefs;var el=m&&m.get(" +
    refLit +
    ");" +
    "if(!el)return {error:'ref_not_found'};" +
    "var tag=el.tagName?el.tagName.toLowerCase():'';" +
    "var ty=((el.getAttribute&&el.getAttribute('type'))||'').toLowerCase();" +
    "if(tag!=='input'||(ty!=='checkbox'&&ty!=='radio'))return {error:'not_checkable'};" +
    "var want=" +
    wantLit +
    ";if(el.checked!==want){el.click();}" +
    "return {ok:true,checked:el.checked===true};" +
    "})()"
  );
}

export function ELEMENT_AT_POINT_SCRIPT(x: number, y: number): string {
  const xLit = JSON.stringify(x);
  const yLit = JSON.stringify(y);
  return (
    "(function(){" +
    "var el=document.elementFromPoint(" +
    xLit +
    "," +
    yLit +
    ");" +
    "if(!el||el.nodeType!==1)return null;" +
    SHARED_HELPERS +
    "var refs=window.__cfRefs||new Map();window.__cfRefs=refs;var ref='e'+(refs.size+1);refs.set(ref,el);" +
    "return describeElement(el,ref);" +
    "})()"
  );
}

export function EVALUATE_SCRIPT(expression: string): string {
  return (
    "(function(){try{" +
    "var __v=(function(){ return (" +
    expression +
    "\n); })();" +
    "var __s;try{__s=JSON.stringify(__v);}catch(e){__s=undefined;}" +
    "if(typeof __s==='string')return {ok:true,kind:'json',data:__s};" +
    "return {ok:true,kind:'str',data:String(__v)};" +
    "}catch(err){return {ok:false,message:(err&&err.message)?String(err.message):String(err)};}})()"
  );
}
