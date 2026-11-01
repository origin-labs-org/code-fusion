import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {strict as assert} from 'node:assert';

class Element {
  constructor(tag, attrs={}, box={x:0,y:0,width:800,height:600}) {
    this.localName=tag;this.attrs=attrs;this.box=box;this.nodeType=1;this.childNodes=[];
    this.parentNode=null;this.currentSrc=attrs.src||'';this.complete=true;this.naturalWidth=400;
  }
  append(child){child.parentNode=this;this.childNodes.push(child);return child;}
  get id(){return this.attrs.id||'';}
  get children(){return this.childNodes.filter(node=>node.nodeType===1);}
  get parentElement(){return this.parentNode?.nodeType===1?this.parentNode:null;}
  get isConnected(){return this.getRootNode().nodeType===9;}
  getRootNode(){let node=this;while(node.parentNode)node=node.parentNode;return node;}
  getAttribute(key){return this.attrs[key]??null;}
  hasAttribute(key){return Object.hasOwn(this.attrs,key);}
  get content(){return this.attrs.content||'';}
  get textContent(){return this.childNodes.map(node=>node.nodeType===3?node.nodeValue:node.textContent).join('');}
  set textContent(text){this.childNodes=[{nodeType:3,nodeValue:text,parentNode:this,parentElement:this,childNodes:[]}];}
  contains(node){for(;node;node=node.parentNode)if(node===this)return true;return false;}
  getBoundingClientRect(){return {...this.box,right:this.box.x+this.box.width,bottom:this.box.y+this.box.height,left:this.box.x,top:this.box.y};}
  querySelector(){return null;}
}
const asset=readFileSync(process.argv[2]||new URL('../crates/zephium-agentic/assets/semantic-record-media-v1.js',import.meta.url),'utf8');
assert.equal(asset.split('Object.freeze({evidence,invoke})').length,2);
// Expose only the private revalidation predicate in this synthetic process.
const program=asset.replace('Object.freeze({evidence,invoke})','Object.freeze({evidence,invoke,target})');
const page='https://catalog.example.test/product?id=7&variant=blue';
function fixture({other=false, metadata=true, duplicate=false, changedUrl=false, responsive=false, pageImage=false, brand=null, declaredBrand=brand, largeDoc=false, negotiated=false}={}) {
  const document={nodeType:9,baseURI:page,URL:page};
  const html=new Element('html');html.parentNode=document;document.documentElement=html;
  document.querySelectorAll=selector=>{assert.equal(selector,'[id]');const found=[],stack=[html];while(stack.length){const n=stack.pop();if(n.nodeType===1&&n.id)found.push(n);stack.push(...(n.childNodes||[]));}return found;};
  const head=html.append(new Element('head'));
  const body=html.append(new Element('body'));
  const main=body.append(new Element('main'));
  const product=main.append(new Element('div'));
  const details=product.append(new Element('div',{}, {x:420,y:0,width:380,height:80}));
  const heading=details.append(new Element('h1',{}, {x:430,y:10,width:350,height:30}));heading.textContent=(brand?brand+' ':'')+'Orbital telescope';
  const gallery=product.append(new Element('div',{}, {x:0,y:0,width:400,height:400}));
  const photo=gallery.append(new Element('img',{src:'https://images.example.test/orbital.webp',alt:''}, {x:0,y:0,width:400,height:350}));
  const counter=gallery.append(new Element('p',{}, {x:0,y:360,width:100,height:25}));counter.textContent=other?'Another product':'1 / 4';
  const script=head.append(new Element('script',{type:'application/ld+json'}));
  const item={'@type':'Product',name:other?'Another product':'Orbital telescope',url:changedUrl?'https://catalog.example.test/product?id=8':page,image:photo.currentSrc};
  if(declaredBrand)item.brand={'@type':'Brand',name:declaredBrand};
  if(responsive){photo.currentSrc='https://images.example.test/orbital-small.webp';photo.attrs.src=photo.currentSrc;photo.attrs.srcset='https://images.example.test/orbital.webp 2x';}
  script.textContent=JSON.stringify(duplicate?[item,{...item,sku:'conflicting'}]:item);
  Object.defineProperty(document,'scripts',{get:()=>head.children.filter(node=>node.localName==='script')});
  if(pageImage){photo.localName='meta';photo.attrs={property:'og:image',content:'https://images.example.test/orbital-og.webp'};}
  const records=[
    {element:heading,media:null,sensitivity:'public',wire:{k:1,r:'heading',l:1,n:(brand?brand+' ':'')+'Orbital telescope',b:{x:430,y:10,w:350,h:30}}},
    {element:photo,media:pageImage?'page_image':'image',sensitivity:'public',wire:{k:2,r:'image',b:{x:0,y:0,w:400,h:350}}},
    {element:counter,media:null,sensitivity:'public',wire:{k:3,r:'paragraph',t:counter.textContent,b:{x:0,y:360,w:100,h:25}}},
    ...(metadata?[{element:script,media:null,sensitivity:'public',wire:{k:4,r:'paragraph',n:'Page facts',t:'Product metadata'}}]:[])
  ];
  if(largeDoc) {
    const unrelated=main.append(new Element('p',{id:'unrelated-label'}));unrelated.textContent='Supplemental label';
    records.push({element:unrelated,media:null,sensitivity:'public',wire:{k:5,r:'paragraph',t:'Supplemental label',b:{x:0,y:0,w:100,h:20}}});
    const content=main.append(new Element('div'));
    for(let i=0;i<300;i++){const group=content.append(new Element('div'));for(let j=0;j<60;j++)group.append(new Element('span'));}
  }
  const context={Element,document,WeakRef,WeakMap,Map,Set,URL,JSON,AbortController,innerWidth:1000,innerHeight:800,
    location:{origin:new URL(page).origin},setTimeout,clearTimeout,addEventListener(){},fetch(){throw Error('no network in structural fixture');},btoa(){throw Error('no pixels in structural fixture');},
    getComputedStyle(node,pseudo){return {display:'block',visibility:'visible',backgroundImage:pseudo?'none':node.attrs.background||'none',content:''};}};
  if (negotiated) {
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0XkAAAAASUVORK5CYII=','base64');
    context.Blob=Blob;
    context.btoa=value=>Buffer.from(value,'binary').toString('base64');
    context.createImageBitmap=async()=>({width:1,height:1,close(){}});
    document.createElement=()=>({width:0,height:0,getContext:()=>({drawImage(){}}),toBlob:reply=>reply(new Blob([png],{type:'image/png'}))});
    context.fetch=async(url,options)=>{
      // The cached page-image variant omitted Vary: Accept.
      const supported=options.cache==='no-store' && options.headers?.Accept==='image/png,image/jpeg,image/webp';
      let sent=false;
      return {ok:true,headers:new Map([['content-type',supported?'image/png':'image/avif']]),body:{getReader:()=>({read:async()=>sent?{done:true}:(sent=true,{done:false,value:png})})}};
    };
  }
  runInNewContext(program,context);
  const api=context.__zephiumRecordMediaV1;
  const helpers={apply:Reflect.apply,read:(get,node)=>get.call(node),nodeContains:Element.prototype.contains,
    elementRect:node=>node.getBoundingClientRect(),tagName:node=>node.localName,nodeType:node=>node.nodeType,
    nodeParentGetter:function(){return this.parentNode;},imageCompleteGetter:function(){return this.complete;},
    imageNaturalWidthGetter:function(){return this.naturalWidth;},pageTitleText:()=>null};
  const rows=api.evidence(records,1,1,helpers);
  return {api,rows,heading,photo,script,document,head,item};
}
const large=fixture({brand:'Acme',pageImage:true,largeDoc:true});
assert(large.rows.find(row=>row.k===2)?.r.includes(1),'an unrelated ARIA scan starved the declared page-entity image');
assert(large.api.target({i:1,g:1,k:2,n:1}),'the bounded entity proof did not survive optional association exhaustion');
const branded=fixture({brand:'Acme',pageImage:true});
assert(branded.rows.find(row=>row.k===2)?.r.includes(1),'declared brand plus exact product name lost the page image');
assert(branded.api.target({i:1,g:1,k:2,n:1}),'brand/name entity proof was not retained');
branded.script.textContent=JSON.stringify({...branded.item,brand:{'@type':'Brand',name:'Other'}});
assert.equal(branded.api.target({i:1,g:1,k:2,n:1}),null,'changed brand reused the prior entity proof');
const wrongBrand=fixture({brand:'Acme',declaredBrand:'Other',pageImage:true});
assert(!wrongBrand.rows.find(row=>row.k===2)?.r.includes(1),'unproven heading prefix acquired a page image');
const good=fixture();
assert(good.rows.find(row=>row.k===2)?.r.includes(1),'a title panel and gallery of the declared page entity lost their association');
assert(good.api.target({i:1,g:1,k:2,n:1}),'fresh exact entity proof was not retained');
good.script.textContent=JSON.stringify({'@type':'Product',name:'Another product',url:page,image:good.photo.currentSrc});
assert.equal(good.api.target({i:1,g:1,k:2,n:1}),null,'changed metadata reused an old entity proof');
for(const options of [{other:true},{metadata:false},{duplicate:true},{changedUrl:true}]) {
  const negative=fixture(options);
  assert(!negative.rows.find(row=>row.k===2)?.r.includes(1),'an unrelated or ambiguous image crossed a record boundary');
}
const renamed=fixture();renamed.heading.textContent='Another product';
assert.equal(renamed.api.target({i:1,g:1,k:2,n:1}),null,'renamed heading reused image authority');
const added=fixture();
const extra=added.head.append(new Element('script',{type:'application/ld+json'}));extra.textContent=JSON.stringify(added.item);
assert.equal(added.api.target({i:1,g:1,k:2,n:1}),null,'a new conflicting entity escaped fresh revalidation');
const redirected=fixture();redirected.document.URL=page.replace('blue','red');
assert.equal(redirected.api.target({i:1,g:1,k:2,n:1}),null,'a changed full-query address reused metadata authority');
const responsive=fixture({responsive:true});
assert(responsive.rows.find(row=>row.k===2)?.r.includes(1),'an explicitly declared responsive image lost its entity relation');
assert(responsive.api.target({i:1,g:1,k:2,n:1}),'responsive image proof was not retained');
delete responsive.photo.attrs.srcset;
assert.equal(responsive.api.target({i:1,g:1,k:2,n:1}),null,'a removed responsive-source relation remained valid');
const tooLarge=fixture();tooLarge.script.textContent=' '.repeat(262145);
assert.equal(tooLarge.api.target({i:1,g:1,k:2,n:1}),null,'oversized metadata escaped the byte bound');
const tooMany=fixture();tooMany.script.textContent=JSON.stringify(Array.from({length:401},()=>({})));
assert.equal(tooMany.api.target({i:1,g:1,k:2,n:1}),null,'exhausted metadata traversal kept an image proof');
const extraScripts=fixture();for(let i=0;i<129;i++)extraScripts.head.append(new Element('script'));
assert.equal(extraScripts.api.target({i:1,g:1,k:2,n:1}),null,'exhausted script inventory kept an image proof');
const declared=fixture({pageImage:true});
assert(declared.rows.find(row=>row.k===2)?.r.includes(1),'observed page image lost its exact declared entity relation');
assert(declared.api.target({i:1,g:1,k:2,n:1}),'page-image entity proof was not retained');
declared.photo.attrs.content='https://images.example.test/unrelated.webp';
assert.equal(declared.api.target({i:1,g:1,k:2,n:1}),null,'changed page-image URI reused an entity proof');
const ambiguous=fixture({pageImage:true});
ambiguous.script.textContent=JSON.stringify([ambiguous.item,{...ambiguous.item,name:'Another item on this page'}]);
assert.equal(ambiguous.api.target({i:1,g:1,k:2,n:1}),null,'two entities sharing a page address retained the page-image authority');
const withoutPageIdentity=fixture({pageImage:true,changedUrl:true});
assert(!withoutPageIdentity.rows.find(row=>row.k===2)?.r.includes(1),'a page image attached to an entity from another full-query address');
console.log('record media structural and metadata custody fixtures passed');

const cors=fixture({pageImage:true});
const invoke=(prefix,extra='')=>cors.api.invoke(`${prefix}:{"i":1,"g":1,"k":2,"n":1${extra}}`,()=>{throw Error('no capture authority');}).then(JSON.parse);
assert.equal((await invoke('M1',',"q":1000')).s,'unavailable','session-only pages must not offer a public fallback');
assert.equal((await invoke('M1',',"p":1,"q":1000')).s,'retry');
const nativeSource=await invoke('M1',',"p":2,"q":1000');
assert.equal(nativeSource.s,'public_asset');
assert.equal(nativeSource.u,'https://images.example.test/orbital-og.webp');
assert.equal((await invoke('U1')).u,nativeSource.u);
assert.equal((await invoke('U1',',"q":1000')).s,'unavailable');
assert.equal((await invoke('X1')).s,'unavailable');
cors.photo.attrs.content='https://images.example.test/changed.webp';
assert.equal((await invoke('U1')).s,'unavailable','changed source cannot publish fetched bytes');
console.log('record image CORS fallback and exact-source revalidation fixtures passed');


// Observed pattern: one explicit ARIA-labelled card overlay, several carousel
// links to that same record, small icon buttons, and transparent grid wrappers.
Object.defineProperty(Element.prototype,'href',{get(){return new URL(this.attrs.href||'',page).href;}});
function cardFixture({mixed=false,wrapped=true,duplicateId=false,extraVisual=false,deep=false}={}) {
  const document={nodeType:9,baseURI:page,URL:page};
  const html=new Element('html');html.parentNode=document;document.documentElement=html;
  document.querySelectorAll=selector=>{assert.equal(selector,'[id]');const found=[],stack=[html];while(stack.length){const n=stack.pop();if(n.nodeType===1&&n.id)found.push(n);stack.push(...(n.childNodes||[]));}return found;};
  const body=html.append(new Element('body')),main=body.append(new Element('main'));
  Object.defineProperty(document,'scripts',{get:()=>[]});
  const records=[],cards=[];
  for(let card=0;card<2;card++) {
    const x=card*350,box={x,y:0,width:320,height:340};
    let parent=main;
    if(wrapped)for(let i=0;i<3;i++)parent=parent.append(new Element('div',{},box));
    const root=parent.append(new Element('div',{role:'group'},box));
    const href='https://catalog.example.test/rooms/'+card+'?check_in=2026-11-18&adults=2';
    const overlay=root.append(new Element('a',{href,'aria-labelledby':'title-'+card},box));
    const content=root.append(new Element('div',{},box));
    const gallery=content.append(new Element('div',{}, {x,y:0,width:320,height:240}));
    let imageParent=gallery;if(deep)for(let depth=0;depth<12;depth++)imageParent=imageParent.append(new Element('div',{}, {x,y:0,width:320,height:240}));
    const image=imageParent.append(new Element('img',{src:'https://images.example.test/room-'+card+'.jpg'}, {x,y:0,width:320,height:240}));
    for(let i=0;i<6;i++)gallery.append(new Element('a',{href:mixed&&card===0&&i===0?'https://catalog.example.test/other':href},{x,y:0,width:320,height:240}));
    const save=gallery.append(new Element('button',{'aria-label':'Save'}, {x:x+280,y:10,width:30,height:30}));
    save.append(new Element('svg',{}, {x:x+285,y:15,width:16,height:16}));
    const badge=gallery.append(new Element('span',{}, {x:x+8,y:8,width:90,height:20}));badge.textContent='Guest favorite';
    gallery.append(new Element('div',{background:'linear-gradient(rgba(0, 0, 0, 0.5), transparent)'},{x,y:0,width:320,height:240}));
    const details=content.append(new Element('div',{}, {x,y:244,width:320,height:90}));
    const name=details.append(new Element('div',{id:'title-'+card}, {x:x+8,y:246,width:300,height:20}));name.textContent='Room by the bay';
    const key=card*20+1;
    records.push({element:name,media:null,sensitivity:'public',wire:{k:key,r:'paragraph',t:name.textContent,b:{x:x+8,y:246,w:300,h:20}}},
      {element:image,media:'image',sensitivity:'public',wire:{k:key+1,r:'image',b:{x,y:0,w:320,h:240}}},
      {element:overlay,media:null,sensitivity:'public',wire:{k:key+2,r:'link',n:name.textContent,u:href,b:{x,y:0,w:320,h:340}}});
    for(let i=0;i<4;i++) {
      const detail=details.append(new Element('div',{}, {x:x+8,y:268+i*14,width:280,height:12}));detail.textContent='Detail '+i;
      records.push({element:detail,media:null,sensitivity:'public',wire:{k:key+3+i,r:'paragraph',t:detail.textContent,b:{x:x+8,y:268+i*14,w:280,h:12}}});
    }
    if(extraVisual&&card===0)gallery.append(new Element('canvas',{}, {x:x+10,y:10,width:100,height:100}));
    cards.push({root,overlay,image,name,gallery,href,key});
  }
  if(duplicateId)main.append(new Element('div',{id:'title-0'}));
  const context={Element,document,WeakRef,WeakMap,Map,Set,URL,JSON,AbortController,innerWidth:1000,innerHeight:800,
    location:{origin:new URL(page).origin},setTimeout,clearTimeout,addEventListener(){},fetch(){throw Error('no network');},btoa(){throw Error('no pixels');},
    getComputedStyle(node,pseudo){return {display:'block',visibility:'visible',backgroundImage:pseudo?'none':node.attrs.background||'none',content:''};}};
  runInNewContext(program,context);
  const api=context.__zephiumRecordMediaV1;
  const helpers={apply:Reflect.apply,read:(get,node)=>get.call(node),nodeContains:Element.prototype.contains,elementRect:node=>node.getBoundingClientRect(),tagName:node=>node.localName,nodeType:node=>node.nodeType,nodeParentGetter:function(){return this.parentNode;},imageCompleteGetter:function(){return this.complete;},imageNaturalWidthGetter:function(){return this.naturalWidth;},pageTitleText:()=>null};
  const rows=api.evidence(records,1,1,helpers);
  return {api,rows,cards};
}
const cards=cardFixture();
for(const card of cards.cards) {
  assert(cards.rows.find(row=>row.k===card.key+1)?.r.includes(card.key),'explicit card label lost its own picture behind carousel links or transparent wrappers');
  assert(!cards.rows.find(row=>row.k===card.key+1)?.r.includes(card.key===1?21:1),'adjacent card stole a same-named picture');
  assert(cards.api.target({i:1,g:1,k:card.key+1,n:card.key}),'fresh ARIA card proof did not revalidate');
}
for(const config of [{mixed:true},{duplicateId:true},{extraVisual:true}]) {
  const bad=cardFixture(config);
  assert(!bad.rows.find(row=>row.k===2)?.r.includes(1),'ambiguous card acquired image authority');
}
cards.cards[0].gallery.children.find(node=>node.localName==='a').attrs.href='https://catalog.example.test/changed';
assert.equal(cards.api.target({i:1,g:1,k:2,n:1}),null,'changed carousel destination reused a card proof');
const full=cardFixture();for(let i=0;i<260;i++)full.cards[0].root.append(new Element('span'));
assert.equal(full.api.target({i:1,g:1,k:2,n:1}),null,'exhausted local card survey kept an old proof');
console.log('ARIA card carousel, wrapper, ambiguity and fresh revalidation fixtures passed');

const idLimit=cardFixture();
for(let i=0;i<2050;i++)idLimit.cards[0].root.getRootNode().documentElement.append(new Element('div',{id:'extra-'+i}));
assert.equal(idLimit.api.target({i:1,g:1,k:2,n:1}),null,'exhausted ID inventory retained an ARIA proof');

for(const background of ['linear-gradient(red,blue), url(https://images.example.test/other.jpg)','linear-gradient(red,blue), paint(other)','image-set(url(https://images.example.test/other.jpg) 1x)']) {
 const mutated=cardFixture();mutated.cards[0].gallery.children.find(node=>node.attrs.background).attrs.background=background;
 assert.equal(mutated.api.target({i:1,g:1,k:2,n:1}),null,'a non-gradient image layer reused the card proof');
}
console.log('decorative-gradient discrimination and mixed-image rejection passed');

const deep=cardFixture({deep:true});assert(deep.api.target({i:1,g:1,k:2,n:1}),'bounded deep carousel nesting lost the exact card');
const below=cardFixture();let branch=below.cards[0].root;while(branch.parentElement?.localName==='div')branch=branch.parentElement;
const stack=[branch];while(stack.length){const node=stack.pop();if(node.nodeType===1){node.box.y+=1000;stack.push(...node.children);}}
assert(below.api.target({i:1,g:1,k:2,n:1}),'scrolling a proven card outside the viewport invalidated its unchanged public image source');
let surveyed=false;const cropOutside=JSON.parse(await below.api.invoke('V1:{"i":1,"g":1,"k":2,"n":1}',()=>{surveyed=true;throw Error('must not capture offscreen');}));
assert.equal(cropOutside.s,'unavailable');assert.equal(surveyed,false,'offscreen crop reached privacy/capture');
const uneven=cardFixture();uneven.cards[1].root.box.height+=24;
assert(uneven.api.target({i:1,g:1,k:2,n:1}),'a neighboring card with a longer caption broke record ownership');
console.log('deep carousels, variable card heights and offscreen crop refusal passed');

const decorated=cardFixture();decorated.cards[0].root.parentElement.append(new Element('div',{}, {...decorated.cards[0].root.box}));
assert(decorated.api.target({i:1,g:1,k:2,n:1}),'a contained overlapping grid decoration broke the exact card proof');
console.log('contained wrapper decoration preserves only the same labelled card');

const negotiated=fixture({negotiated:true});
let attemptedCrop=false;
const negotiatedResult=JSON.parse(await negotiated.api.invoke('M1:{"i":1,"g":1,"k":2,"n":1}',()=>{attemptedCrop=true;throw Error('no screenshot authority');}));
assert.equal(negotiatedResult.s,'fetch','supported-format negotiation must retrieve the asset before crop fallback');
assert.equal(attemptedCrop,false,'a usable fetched image must not depend on screenshot authority');
console.log('image content negotiation preserves native fetch without pixel capture');
