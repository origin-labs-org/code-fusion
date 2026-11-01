(() => {
  "use strict";
  const NAME="__zephiumRecordMediaV1";
  if(Object.hasOwn(globalThis,NAME))return;
  const snapshots=new Map(), style=getComputedStyle, rect=Element.prototype.getBoundingClientRect;
  const fetchAsset=fetch, encode=btoa, stringify=JSON.stringify, parse=JSON.parse;
  const MAX_RAW=524288, MAX_OUTPUT=65536;
  const relations=new WeakMap();
  let pending=null;
  addEventListener("pagehide",()=>{if(pending)pending.abort();snapshots.clear();},true);
  function source(node,kind) {
    if(kind==="image")return node.currentSrc||"";
    if(kind==="poster")return node.poster||"";
    if(kind==="page_image")return node.content||"";
    if(kind==="background") {
      const value=style(node).backgroundImage;
      const match=/^url\(["']?([^"'\\]+?)["']?\)$/.exec(value);
      return match && match[1].length<=4096?match[1]:"";
    }
    return "";
  }
  function observedImageSources(node) {
    const out=new Set();let work=0;
    const add=value=>{if(!value || value.length>4096 || ++work>32)return;try{out.add(new URL(value,document.baseURI).href);}catch(_){}};
    const sources=element=>{
      for(const attr of ["src","data-src"])add(element.getAttribute(attr));
      for(const attr of ["srcset","data-srcset"]) {
        const value=element.getAttribute(attr)||"";if(value.length>8192)continue;
        for(const item of value.split(",").slice(0,16)) {
          const match=/^\s*(\S+)(?:\s+(?:[0-9]+w|[0-9.]+x))?\s*$/.exec(item);
          if(match && !match[1].startsWith("data:"))add(match[1]);
        }
      }
    };
    sources(node);
    if(node.parentElement?.localName==="picture")for(const sibling of [...node.parentElement.children].slice(0,5))if(sibling.localName==="source")sources(sibling);
    return out;
  }
  function label(node) {
    const stack=[node];let text="",visited=0;
    while(stack.length) {
      const current=stack.pop();if(++visited>64)return null;
      if(current.nodeType===3){const value=current.nodeValue;if(value.length+text.length>2048)return null;text+=value;}
      else if(current.nodeType===1) {for(let i=current.childNodes.length-1;i>=0;i--){if(stack.length>=64)return null;stack.push(current.childNodes[i]);}}
    }
    const aria=node.getAttribute("aria-label")||"";return aria.length<=2048?text+"|"+aria:null;
  }
  const normalized=value=>typeof value==="string" && value.length<=2048?value.normalize("NFC").replace(/\s+/gu," ").trim():null;
  const address=value=>{try{if(typeof value!=="string" || value.length>4096)return null;const u=new URL(value,document.baseURI);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch(_){return null;}};
  function entities(script,charge) {
    if(!script.isConnected || script.localName!=="script" || script.getAttribute("type")!=="application/ld+json")return null;
    const raw=script.textContent;if(raw.length>262144)return null;
    let pending;try{pending=[parse(raw)];}catch(_){return null;}
    const out=[];let seen=0;
    while(pending.length) {
      if(++seen>400 || !charge())return null;
      const item=pending.pop();if(item===null || typeof item!=="object")continue;
      if(Array.isArray(item)){if(item.length+pending.length>400)return null;pending.push(...item);continue;}
      const types=Array.isArray(item["@type"])?item["@type"]:[item["@type"]];
      if(types.some(type=>["Product","ProductGroup","Book","VideoObject"].includes(type))) {
        const url=address(item.url || item.mainEntityOfPage?.["@id"] || item.mainEntityOfPage || (!Array.isArray(item.offers)&&item.offers?.url));
        const name=normalized(item.name),rawImages=item.image || item.thumbnailUrl;
        const images=(Array.isArray(rawImages)?rawImages:[rawImages]);
        if(images.length>32 || out.length>=24)return null;
        if(name && url)out.push({name,url,brand:normalized(typeof item.brand==="string"?item.brand:item.brand?.name),images:images.map(image=>address(typeof image==="string"?image:image?.url||image?.contentUrl)).filter(Boolean)});
      }
      for(const key of ["@graph","itemListElement","item","mainEntity","hasVariant"])if(item[key]!==undefined){if(pending.length>=400)return null;pending.push(item[key]);}
    }
    return out;
  }
  function pageEntityName(node) {
    if(node.getAttribute("aria-label") || node.getAttribute("aria-labelledby"))return null;
    const text=label(node);return text===null?null:normalized(text.slice(0,-1));
  }
  function entityCatalog(charge) {
    const scripts=document.scripts;if(!scripts || scripts.length>128)return null;
    const parsed=[];
    for(let i=0;i<scripts.length;i++) {
      if(!charge())return null;
      const node=scripts[i];if(node.getAttribute("type")!=="application/ld+json")continue;
      if(parsed.length===4)return null;
      const items=entities(node,charge);if(items===null)return null;
      parsed.push({node,items});
    }
    return parsed;
  }
  const entityNameMatches=(item,title)=>item.name===title || !!item.brand && item.brand+" "+item.name===title;
  // Exact page entity joins split panels; never infer resized-URL equality.
  function entityWitness(records,images,rows,charge) {
    const page=address(document.URL);if(!page)return;
    const observed=new Set(records.filter(r=>r.element.localName==="script" && r.sensitivity!=="secret").map(r=>r.element));
    if(!observed.size)return;
    const parsed=entityCatalog(charge);if(parsed===null)return;
    for(const record of records) {
      if(!charge())return;
      if(record.wire.r!=="heading" || record.wire.l!==1 || record.sensitivity!=="public")continue;
      const title=normalized(record.wire.n);if(!title || pageEntityName(record.element)!==title)continue;
      const matches=parsed.flatMap(script=>script.items.filter(item=>item.url===page).map(item=>({script:script.node,item})));
      if(matches.length!==1 || !entityNameMatches(matches[0].item,title) || !observed.has(matches[0].script))continue;
      for(let index=0;index<images.length;index++) {
        if(!charge())return;
        const image=images[index],row=rows[index];
        if(!["image","page_image"].includes(image.media) || row.r.length>=8 || row.r.includes(record.wire.k))continue;
        const declared=observedImageSources(image.element);declared.add(address(source(image.element,image.media)));
        const pageImage=image.media==="page_image" && images.filter(image=>image.media==="page_image").length===1;
        const identity=pageImage?address(source(image.element,image.media)):matches[0].item.images.find(url=>declared.has(url));if(!identity)continue;
        row.r.push(record.wire.k);
        let bound=relations.get(row);if(!bound){bound=new Map();relations.set(row,bound);}
        bound.set(record.wire.k,{kind:"entity",script:new WeakRef(matches[0].script),title,page,identity,pageImage});
      }
    }
  }

  function sharedCard(a,b) {
    let parent=b;
    for(let depth=0;depth<8 && parent && parent.nodeType===1;depth++,parent=parent.parentNode) {
      if(["html","body","main","nav","header","footer","aside"].includes(parent.localName))return null;
      if(parent.contains(a))return parent;
    }
    return null;
  }
  function remember(i,g,records,rows) {
    const entries=new Map();
    for(const row of rows) {
      const record=records.find(record=>record.wire.k===row.k);if(!record)continue;
      const names=new Map();
      for(const key of row.r) {
        const name=records.find(record=>record.wire.k===key);if(!name)continue;
        const card=sharedCard(record.element,name.element);
        const text=label(name.element);
        const witness=relations.get(row)?.get(key);
        if(text!==null && (card || row.t==="page_image" || witness?.kind==="entity")) names.set(key,{node:new WeakRef(name.element),card:card?new WeakRef(card):null,text,witness});
      }
      const url=source(record.element,row.t);if(url.length>4096)continue;
      const content=row.t==="record"?label(record.element):null;
      if(row.t==="record" && content===null)continue;
      entries.set(row.k,{node:new WeakRef(record.element),kind:row.t,content,source:url,lazy:row.t==="image" && !url?observedImageSources(record.element):null,names});
    }
    const key=i+":"+g;snapshots.delete(key);snapshots.set(key,entries);
    while(snapshots.size>8)snapshots.delete(snapshots.keys().next().value);
  }

// Only known gradient layers are decorative; URLs, paint worklets and
// unknown image functions remain visual ambiguity, including in mixed layers.
function decorativeBackground(value) {
  if(value==='none')return true;
  if(value.length>4096 || /(?:url|paint|image-set|element)\s*\(/i.test(value))return false;
  let at=0,layers=0;
  while(at<value.length && ++layers<=8) {
    while(/\s/.test(value[at]||'') && at<value.length)at++;
    const prefix=value.slice(at).match(/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i);
    if(!prefix)return false;
    at+=prefix[0].length;let depth=1;
    while(at<value.length && depth) {
      const c=value[at++];
      if(c==='"' || c==="'" || c==='\\' || c===';')return false;
      if(c==='(' && ++depth>16)return false;
      if(c===')')depth--;
    }
    if(depth)return false;
    while(at<value.length && /\s/.test(value[at]))at++;
    if(at===value.length)return true;
    if(value[at++]!==',')return false;
  }
  return false;
}

function ariaRecordProof(records, nameRecord, charge, cache) {
  const name = nameRecord.element;
  if (nameRecord.wire.r !== 'paragraph' || !name.id || name.getRootNode() !== document) return null;
  // No uniqueness inference from the truncated semantic snapshot.
  const walk = (root, limit, visitor) => {
    const stack = [root]; let seen = 0;
    while (stack.length) {
      const node = stack.pop();
      if (++seen > limit || !charge()) return false;
      if (visitor(node) === false) return false;
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        if (stack.length >= limit) return false;
        stack.push(node.childNodes[i]);
      }
    }
    return true;
  };
  if (!walk(name,32,node=>{
    if (node.nodeType!==1 || node===name) return;
    if (!["span","b","strong","em","i","u","s","small","mark","time","abbr","br"].includes(node.localName)) return false;
    if (node.shadowRoot || node.isContentEditable || ["link","button","textbox"].includes(node.getAttribute("role"))) return false;
  })) return null;
  if (!cache.ids) {
    const ids=new Map();
    for(const record of records) {
      if(!charge())return null;
      const id=record.element.id;
      if(record.wire.r==='paragraph' && id && id.length<=512)ids.set(id,0);
    }
    cache.ids=ids;
    // Native selection inventories every ID without spending the shared JS
    // traversal allowance on unrelated text and decorative descendants.
    const declared=document.querySelectorAll('[id]');
    cache.complete=declared.length<=2048;
    if(cache.complete)for(const node of declared) {
      if(!charge()){cache.complete=false;break;}
      if(ids.has(node.id))ids.set(node.id,Math.min(2,ids.get(node.id)+1));
    }
  }
  if(!cache.complete || cache.ids.get(name.id)!==1)return null;
  const visible = node => {
    const s = style(node), b = rect.call(node);
    return s.display !== 'none' && s.visibility === 'visible' && b.width > 0 && b.height > 0;
  };
  const bname = rect.call(name);
  const sameBox = (a, b) => Math.abs(a.x-b.x)<=2 && Math.abs(a.y-b.y)<=2 && Math.abs(a.width-b.width)<=2 && Math.abs(a.height-b.height)<=2;
  let root = name.parentElement;
  for (let depth=0; root && depth<8; depth++,root=root.parentElement) {
    if (!charge() || ['html','body','main','nav','header','footer','aside','article','li'].includes(root.localName) || root.getAttribute('role')==='listitem') return null;
    const links = [], visuals = [], texts = [];
    if (!walk(root,256,node => {
      if (node.nodeType===3) {
        if (node.nodeValue.length>2048) return false;
        if (/\S/.test(node.nodeValue) && node.parentElement && visible(node.parentElement)) texts.push(node);
        return;
      }
      if (node.nodeType!==1) return;
      const tag=node.localName, s=style(node);
      if (node.shadowRoot || tag.includes('-') || ['iframe','frame','object','embed','input','textarea','select'].includes(tag) || node.isContentEditable) return false;
      if (node!==root && (['article','li'].includes(tag) || node.getAttribute('role')==='listitem')) return false;
      if (tag==='a' || node.getAttribute('role')==='link') links.push(node);
      const visual=['img','video','canvas','svg'].includes(tag) || !decorativeBackground(s.backgroundImage);
      if (visual && visible(node)) {
        const b=rect.call(node);
        // Small controls and avatars are not listing pictures. Large unobserved
        // visuals still count, so an incomplete card cannot gain ownership.
        if (b.width>=64 && b.height>=48) visuals.push(node);
      }
      for (const pseudo of ['::before','::after']) {
        const p=style(node,pseudo);
        if (!decorativeBackground(p.backgroundImage) || p.content.includes('url(')) return false;
      }
    })) return null;
    if (!visuals.length || !links.length) continue;
    const labelled=links.filter(link=>(link.getAttribute('aria-labelledby')||'').trim()===name.id);
    // Carousel links can precede the card's accessibility-labelled overlay.
    if (!labelled.length) continue;
    if (visuals.length!==1 || labelled.length!==1) return null;
    const visual=visuals[0], link=labelled[0], box=rect.call(root);
    if (!link.hasAttribute('href') || links.some(other=>!other.hasAttribute('href') || other.href!==link.href) || !visible(link) || !visible(visual) || !sameBox(rect.call(link),box)) return null;
    const imageRecord=records.find(r=>r.element===visual && r.media && r.media!=='page_image' && r.media!=='record');
    const linkRecord=records.find(r=>r.element===link && r.wire.r==='link' && r.wire.u);
    if (!imageRecord || !linkRecord || link.href.length>4096) return null;
    const image=rect.call(visual);
    if (image.width<64 || image.height<48 || bname.y<image.bottom-2 || bname.y-image.bottom>32 || bname.x<image.x-2 || bname.right>image.right+2 ||
        box.width>image.width+32 || image.x<box.x-2 || image.right>box.right+2) return null;
    let content=visual.parentElement;
    for(let depth=0;content && !content.contains(name) && depth<32;depth++){if(!charge())return null;content=content.parentElement;}
    if(!content || !root.contains(content) || !content.contains(name))return null;
    let branch=visual;
    while(branch.parentElement!==content) {
      if (!charge() || !branch.parentElement) return null;
      branch=branch.parentElement;
    }
    // First card text must be this Name; photo-branch text is ambiguous.
    const caption=texts.filter(text=>!branch.contains(text));
    if (!caption.length || !name.contains(caption[0])) return null;
    let peerRoot=root, peers=null;
    for(let depth=0;depth<8;depth++) {
      const parent=peerRoot.parentElement;
      if(!parent || parent.children.length>64 || !charge())return null;
      const visiblePeers=[];
      for(const peer of parent.children){if(!charge())return null;if(visible(peer))visiblePeers.push(peer);}
      const separate=visiblePeers.some(peer=>peer!==peerRoot && (()=>{const b=rect.call(peer);return b.right<=box.left+2 || b.left>=box.right-2 || b.bottom<=box.top+2 || b.top>=box.bottom-2;})());
      if(separate){peers=visiblePeers;break;}
      if(!['div','section'].includes(parent.localName) || parent.getAttribute('role') || !sameBox(rect.call(parent),box) ||
          visiblePeers.some(peer=>{const b=rect.call(peer);return b.left<box.left-2 || b.right>box.right+2 || b.top<box.top-2 || b.bottom>box.bottom+2;}))return null;
      peerRoot=parent;
    }
    if (!peers || peers.length<2) return null;
    let repeated=false;
    for (const peer of peers) {
      if (!charge()) return null;
      if (peer===peerRoot || peer.localName!==peerRoot.localName || !visible(peer)) continue;
      const b=rect.call(peer);
      if (Math.abs(b.width-box.width)<=2 &&
          (b.right<=box.left+2 || b.left>=box.right-2 || b.bottom<=box.top+2 || b.top>=box.bottom-2)) repeated=true;
    }
    if (!repeated) return null;
    return {name,link,root,visual,imageRecord,linkRecord,id:name.id,href:link.href};
  }
  return null;
}

  function evidence(records, invocation, generation, helpers) {
    const {apply,read,nodeContains,elementRect,tagName,nodeType,nodeParentGetter,imageCompleteGetter,imageNaturalWidthGetter,pageTitleText}=helpers;
    const candidates=records.filter(record=>record.media!==null && record.sensitivity!=="secret" &&
      (record.media==="page_image" || record.wire.b && record.wire.b.w>=64 && record.wire.b.h>=48));
    let work=0;
    const linkProofs=new WeakMap(),provenNames=new Set();
    const links=new WeakSet(records.filter(r=>r.wire.r==="link").map(r=>r.element));
    const counts=new WeakMap(),textOwners=new WeakSet(),imageOwners=new WeakMap(),boundaries=new WeakMap();
    const indexAncestors=(items,visit)=>{
      for(let index=0;index<items.length;index++) {
        let node=items[index].element,depth=0;
        while(node && nodeType(node)===1 && !["html","body"].includes(tagName(node))) {
          if(++work>16384 || ++depth>64)return false;
          visit(node,index);node=read(nodeParentGetter,node);
        }
      }
      return true;
    };
    const titles=records.filter(record=>record.wire.r==="heading");
    const identities=records.filter(record=>
      ["heading","paragraph"].includes(record.wire.r) && (record.wire.n || record.wire.t) ||
      record.wire.r==="link" && label(record.element)?.split("|")[0].trim());
    if(!indexAncestors(titles,node=>counts.set(node,Math.min(2,(counts.get(node)||0)+1))) ||
       !indexAncestors(identities,node=>textOwners.add(node)))return [];
    // Same64-node/stack bound as labels; no text or field values are read.
    const uniqueImage=(root,wanted)=>{
      const stack=[root];let visited=0,found=false;
      while(stack.length) {
        const node=stack.pop();if(++visited>64 || ++work>16384)return false;
        if(nodeType(node)!==1)continue;
        const tag=tagName(node);
        if(node.shadowRoot || tag.includes("-") || ["iframe","frame","object","embed"].includes(tag))return false;
        if(node===wanted)found=true;
        else if(["img","video","canvas","svg"].includes(tag) || style(node).backgroundImage!=="none")return false;
        for(const part of ["::before","::after"]) {
          const css=style(node,part);if(css.backgroundImage!=="none" || css.content.includes("url("))return false;
        }
        for(const child of node.childNodes){if(stack.length>=64)return false;stack.push(child);}
      }
      return found;
    };
    const cardBoundary=element=>{
      const tag=tagName(element),role=element.getAttribute("role");
      if(tag==="article" || tag==="li" || role==="listitem")return true;
      if(!["div","section","figure"].includes(tag) && !tag.includes("-") && role!=="group")return false;
      if(boundaries.has(element))return boundaries.get(element);
      const parent=element.parentElement;let boundary=false;
      if(parent && textOwners.has(element)) {
        if(parent.children.length>64)boundary=true;
        else for(const peer of parent.children) {
          if(++work>16384)return true;
          if(peer!==element && peer.localName===tag && textOwners.has(peer)){boundary=true;break;}
        }
      }
      boundaries.set(element,boundary);return boundary;
    };
    const images=candidates.filter(record=>record.media!=="record").slice(0,48);
    for(const record of candidates) {
      if(record.media!=="record" || images.length>=48)continue;
      const node=record.element,b=record.wire.b;
      if(b.w*b.h>innerWidth*innerHeight/2 || label(node)===null || node.children.length>64 ||
          node.querySelector("input,textarea,select,iframe,frame,object,embed,[contenteditable]"))continue;
      let nested=false;
      for(const other of candidates) {
        if(++work>16384)return [];
        if(other!==record && other.media==="record" && apply(nodeContains,node,[other.element])){nested=true;break;}
      }
      if(nested || (counts.get(node)||0)>1 || [...node.children].some(child=>cardBoundary(child)))continue;
      images.push(record);
    }
    if(work>16384 || !images.length)return [];
    if(!indexAncestors(images,(node,index)=>{
      const entries=imageOwners.get(node)||[];entries.push(index);imageOwners.set(node,entries);
    }))return [];
    const rows=images.map(record=>({k:record.wire.k,t:record.media,r:[],l:record.media!=="image" ||
      read(imageCompleteGetter,record.element)===true && read(imageNaturalWidthGetter,record.element)>=32}));
    const inside=(outer,inner)=>outer && inner && inner.x>=outer.x-2 && inner.y>=outer.y-2 &&
      inner.x+inner.w<=outer.x+outer.width+2 && inner.y+inner.h<=outer.y+outer.height+2;
    association: for(const record of records) {
      if(!["heading","link","paragraph","document","list_item"].includes(record.wire.r) ||
         !(record.wire.n || record.wire.t) || record.sensitivity==="secret")continue;
      let parent=record.element;
      for(let depth=0;depth<8 && parent && parent!==document;depth++) {
        if(++work>16384)break association;
        if(nodeType(parent)!==1 || ["html","body","main","nav","header","footer","aside"].includes(tagName(parent)))break;
        if((counts.get(parent)||0)>1)break;
        const box=elementRect(parent),related=[];let visual=-1,visuals=0;
        for(const index of imageOwners.get(parent)||[]) {
          if(++work>16384)break association;
          const image=images[index];
          if(image.media!=="page_image" && inside(box,image.wire.b) && inside(box,record.wire.b)) {
            related.push(index);if(image.media!=="record"){visual=index;visuals++;}
          }
        }
        if(related.length) {
          for(const index of related)if(rows[index].r.length<8)rows[index].r.push(record.wire.k);
          if(visuals)provenNames.add(record.wire.k);
          const owned=imageOwners.get(record.element);
          if(visuals===1 && record.wire.u && owned?.length===1 && owned[0]===visual && links.has(record.element) && rows[visual].r.includes(record.wire.k) && uniqueImage(record.element,images[visual].element))
            linkProofs.set(record.element,{index:visual,parent});
          break;
        }
        if(cardBoundary(parent))break;
        if(work>16384)break association;
        parent=read(nodeParentGetter,parent);
      }
      if(pageTitleText(record.element,tagName(record.element))!==null) {
        for(let index=0;index<images.length;index++) {
          if(++work>16384)break association;
          if(images[index].media==="page_image" && rows[index].r.length<4)rows[index].r.push(record.wire.k);
        }
      }
    }
    // A captured paragraph may inherit only its own enclosing link's already
    // proven single-image association. No labels, URL equality, or new card rule.
    inheritance: for(const record of records) {
      if(record.wire.r!=="paragraph" || record.sensitivity==="secret" || provenNames.has(record.wire.k))continue;
      let parent=read(nodeParentGetter,record.element);
      for(let depth=0;depth<8 && parent;depth++,parent=read(nodeParentGetter,parent)) {
        if(++work>16384)break inheritance;
        if(nodeType(parent)!==1 || ["html","body","main","nav","header","footer","aside","article","li"].includes(tagName(parent)) || parent.getAttribute("role")==="listitem" || (counts.get(parent)||0)>1)break;
        if(links.has(parent)) {
          const proof=linkProofs.get(parent);
          if(proof) {
            const row=rows[proof.index],box=elementRect(proof.parent);
            if(row.r.length<8 && inside(box,record.wire.b) && inside(box,images[proof.index].wire.b))row.r.push(record.wire.k);
          }
          break;
        }
        if(cardBoundary(parent)) {
          const siblings=parent.parentElement;if(work>16384 || !siblings || siblings.children.length>64)break;
          let separate=false;
          for(const peer of siblings.children) {
            if(++work>16384)break inheritance;
            if(peer!==parent && imageOwners.has(peer)){separate=true;break;}
          }
          if(separate)break;
        }
      }
    }
    // Resolve explicit page identity before optional full-DOM ARIA scans.
    entityWitness(records,images,rows,()=>++work<=16384);
    // An exact accessibility label still needs a unique local record proof.
    // First-pass and enclosing-link associations above remain unchanged.
    const ariaIndex={};
    for(const record of records) {
      if(work>=16384)break;
      if (record.wire.r!=="paragraph" || record.sensitivity==="secret" || provenNames.has(record.wire.k))continue;
      const proof=ariaRecordProof(records,record,()=>++work<=16384,ariaIndex);
      if(!proof)continue;
      const index=images.findIndex(image=>image.element===proof.visual),row=rows[index];
      if(!row || row.r.length>=8 || row.r.includes(record.wire.k))continue;
      row.r.push(record.wire.k);
      let bound=relations.get(row);if(!bound){bound=new Map();relations.set(row,bound);}
      bound.set(record.wire.k,{link:new WeakRef(proof.link),root:new WeakRef(proof.root),id:proof.id,href:proof.href});
    }
    remember(invocation,generation,records,rows);
    return rows;
  }

  let targetRefusal=1,fetchStage=0;
  const unavailable=r=>({v:1,s:"unavailable",r,f:fetchStage});
  function target(request) {
    targetRefusal=1;
    const entry=snapshots.get(request.i+":"+request.g)?.get(request.k),name=entry?.names.get(request.n);
    const node=entry?.node.deref(),named=name?.node.deref(),card=name?.card?.deref();
    if(!entry || !name)return null;
    targetRefusal=2;if(!node?.isConnected || !named?.isConnected)return null;
    targetRefusal=3;if(label(named)!==name.text)return null;
    targetRefusal=4;
    if(name.witness?.kind==="entity") {
      const witness=name.witness,script=witness.script.deref();let work=0;
      if(!script || address(document.URL)!==witness.page || pageEntityName(named)!==witness.title)return null;
      const catalog=entityCatalog(()=>++work<=16384),matches=catalog?.flatMap(part=>part.items.filter(item=>item.url===witness.page).map(item=>({script:part.node,item})));
      const declared=observedImageSources(node);declared.add(address(source(node,entry.kind)));
      if(matches?.length!==1 || matches[0].script!==script || !entityNameMatches(matches[0].item,witness.title) || (!witness.pageImage && !matches[0].item.images.includes(witness.identity)) || !declared.has(witness.identity))return null;
    } else if(entry.kind!=="page_image" && (!card?.isConnected || !card.contains(node) || !card.contains(named))){targetRefusal=5;return null;}
    if(name.witness && name.witness.kind!=="entity") {
      const witness=name.witness,link=witness.link.deref(),root=witness.root.deref();
      if(!link?.isConnected || !root?.isConnected)return null;
      const records=[{element:named,media:null,wire:{r:"paragraph"}},{element:node,media:entry.kind,wire:{r:"image"}},{element:link,media:null,wire:{r:"link",u:witness.href}}];
      let spent=0;
      const proof=ariaRecordProof(records,records[0],()=>++spent<=16384,{});
      if(!proof || proof.link!==link || proof.root!==root || proof.id!==witness.id || proof.href!==witness.href)return null;
    }
    if(entry.kind==="record" && label(node)!==entry.content)return null;
    const url=source(node,entry.kind);
    targetRefusal=6;if(url!==entry.source && !(entry.kind==="image" && entry.lazy?.has(url) && node.complete && node.naturalWidth>=32))return null;
    return {entry,node,url};
  }
  function crop(request,privacy) {
    const current=target(request);if(!current)return unavailable(targetRefusal);if(current.entry.kind==="page_image")return unavailable(7);
    const box=rect.call(current.node),computed=style(current.node);
    if(computed.visibility!=="visible" || computed.display==="none" || box.width<64 || box.height<48 ||
       box.x<0 || box.y<0 || box.right>innerWidth || box.bottom>innerHeight)return unavailable(7);
    if(current.entry.kind==="image" && (!current.node.complete || current.node.naturalWidth<32))return unavailable(8);
    let proof;try{proof=parse(privacy());}catch(_){return unavailable(9);}if(!proof.c)return unavailable(9);
    return {v:1,s:"crop",p:proof,i:request.i,g:request.g,k:request.k,n:request.n,b:{x:box.x,y:box.y,w:box.width,h:box.height}};
  }
  function dimensions(bytes,type) {
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),n=bytes.length;
    const u16=(at)=>at+2<=n?view.getUint16(at):0,u32=(at)=>at+4<=n?view.getUint32(at):0;
    const le24=(at)=>at+3<=n?bytes[at]|bytes[at+1]<<8|bytes[at+2]<<16:0;
    const word=(at,value)=>at+value.length<=n && [...value].every((c,i)=>bytes[at+i]===c.charCodeAt(0));
    let size=null;
    if(type==="image/png" && n>=33 && u32(0)===0x89504e47 && u32(4)===0x0d0a1a0a && word(12,"IHDR") && u32(8)===13) {
      for(let at=8;at+12<=n;){const length=u32(at);if(length>n-at-12 || word(at+4,"acTL"))return null;at+=length+12;}
      size=[u32(16),u32(20)];
    } else if(type==="image/jpeg" && n>=4 && u16(0)===0xffd8) {
      for(let at=2;at+4<=n;) {
        if(bytes[at++]!==255)return null;while(at<n && bytes[at]===255)at++;
        const marker=bytes[at++];if(marker===0xda || marker===0xd9)break;
        if(marker===0x01 || marker>=0xd0 && marker<=0xd7)continue;
        const length=u16(at);if(length<2 || at+length>n)return null;
        if([0xc0,0xc1,0xc2].includes(marker)) {if(length<8)return null;size=[u16(at+5),u16(at+3)];break;}
        at+=length;
      }
    } else if(type==="image/webp" && n>=30 && word(0,"RIFF") && word(8,"WEBP")) {
      if(word(12,"VP8X")) {if(bytes[20]&2)return null;size=[le24(24)+1,le24(27)+1];}
      else if(word(12,"VP8 ") && bytes[23]===0x9d && bytes[24]===1 && bytes[25]===0x2a)size=[view.getUint16(26,true)&16383,view.getUint16(28,true)&16383];
      else if(word(12,"VP8L") && bytes[20]===0x2f)size=[1+((bytes[22]&63)<<8|bytes[21]),1+((bytes[24]&15)<<10|bytes[23]<<2|bytes[22]>>6)];
    }
    return size && size.every(value=>value>0 && value<=2048)?size:null;
  }
  async function sanitize(parts,total,type,signal) {
    const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    fetchStage=6;const size=dimensions(bytes,type);if(!size || signal.aborted)throw new Error();
    fetchStage=7;const bitmap=await createImageBitmap(new Blob([bytes],{type}));
    try {
      if(signal.aborted || bitmap.width!==size[0] || bitmap.height!==size[1])throw new Error();
      fetchStage=8;const canvas=document.createElement("canvas"),context=canvas.getContext("2d",{alpha:false});if(!context)throw new Error();
      try {
        for(const [width,height] of [[320,240],[240,180],[160,120],[80,60]]) {
          if(signal.aborted)throw new Error();
          const scale=Math.min(1,width/size[0],height/size[1]);canvas.width=Math.max(1,Math.floor(size[0]*scale));canvas.height=Math.max(1,Math.floor(size[1]*scale));
          context.drawImage(bitmap,0,0,canvas.width,canvas.height);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
          if(signal.aborted)throw new Error();
          if(blob && blob.size>0 && blob.size<=MAX_OUTPUT) {
            const output=new Uint8Array(await blob.arrayBuffer());if(signal.aborted || output.length>MAX_OUTPUT)throw new Error();return output;
          }
        }
        throw new Error();
      } finally {canvas.width=canvas.height=1;}
    } finally {bitmap.close();}
  }
  async function invoke(encoded,privacy) {
    if(pending)return stringify(unavailable(11));
    fetchStage=0;
    if(typeof encoded!=="string" || encoded.length>256 || !["M1:","V1:","U1:"].includes(encoded.slice(0,3)))return stringify(unavailable(10));
    let request;
    try {request=parse(encoded.slice(3));}catch(_){return stringify(unavailable(10));}
    if(!["g,i,k,n","g,i,k,n,q","g,i,k,n,p,q"].includes(Object.keys(request).sort().join(",")) || !Object.values(request).every(value=>Number.isSafeInteger(value)&&value>0) || request.q>1500 || request.p && request.p!==1 && request.p!==2 || (encoded.startsWith("V1:") || encoded.startsWith("U1:")) && (request.p||request.q))return stringify(unavailable(10));
    const current=target(request);if(!current)return stringify(unavailable(targetRefusal));
    if(encoded.startsWith("V1:"))return stringify(crop(request,privacy));
    const url=current.url;
    if(encoded.startsWith("U1:")) {
      let parsed;try{parsed=new URL(url,document.baseURI);}catch(_){return stringify(unavailable(10));}
      return stringify(parsed.protocol==="https:" && parsed.origin!==location.origin?{v:1,s:"public_asset",i:request.i,g:request.g,k:request.k,n:request.n,u:url}:unavailable(10));
    }
    if(!url || url.length>4096)return stringify(crop(request,privacy));
    let parsed;try {parsed=new URL(url,document.baseURI);}catch(_){return stringify(crop(request,privacy));}
    if(!["https:","http:","blob:","data:"].includes(parsed.protocol))return stringify(crop(request,privacy));
    if(request.p===2 && (!["https:","http:"].includes(parsed.protocol) || parsed.origin===location.origin))return stringify(unavailable(10));
    const abort=new AbortController();pending=abort;let headers=false;
    const timer=setTimeout(()=>abort.abort(),request.q||1500);
    try {
      // Image caches can hold a negotiated format without a Vary: Accept key.
      fetchStage=1;const response=await fetchAsset(url,{signal:abort.signal,credentials:request.p===2?"omit":current.node.crossOrigin==="anonymous"?"same-origin":"include",mode:"cors",redirect:"error",headers:{Accept:"image/png,image/jpeg,image/webp"},cache:"no-store"});
      headers=true;const type=(response.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
      fetchStage=2;if(!response.ok)throw new Error();
      fetchStage=3;if(!["image/png","image/jpeg","image/webp"].includes(type))throw new Error();
      fetchStage=4;if(Number(response.headers.get("content-length")||0)>MAX_RAW || !response.body)throw new Error();
      fetchStage=5;const reader=response.body.getReader(),parts=[];let total=0;
      while(true){const item=await reader.read();if(item.done)break;total+=item.value.length;if(total>MAX_RAW){abort.abort();throw new Error();}parts.push(item.value);}
      if(!target(request) || abort.signal.aborted)throw new Error();
      const output=await sanitize(parts,total,type,abort.signal);
      if(!target(request) || abort.signal.aborted)throw new Error();
      let binary="";for(const value of output)binary+=String.fromCharCode(value);
      return stringify({v:1,s:"fetch",i:request.i,g:request.g,k:request.k,n:request.n,bytes:encode(binary)});
    } catch(_) {
      if(request.p===1 && !headers && !abort.signal.aborted && ["https:","http:"].includes(parsed.protocol) && parsed.origin!==location.origin && target(request))return stringify({v:1,s:"retry",i:request.i,g:request.g,k:request.k,n:request.n});
      if(request.p===2 && !headers && !abort.signal.aborted && parsed.protocol==="https:" && target(request))return stringify({v:1,s:"public_asset",i:request.i,g:request.g,k:request.k,n:request.n,u:url});
      return stringify(crop(request,privacy));
    }
    finally {clearTimeout(timer);pending=null;}
  }
  Object.defineProperty(globalThis,NAME,{value:Object.freeze({evidence,invoke}),writable:false,configurable:false});
})();
