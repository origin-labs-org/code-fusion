(()=>{"use strict";
const w=globalThis.webkit,h=w&&w.messageHandlers&&w.messageHandlers.zephiumPageAssistBootV1;
if(!h)return;
const post=h.postMessage,apply=Reflect.apply,run=Function;
let serve=null,token="",pulling=false,again=false;
const pull=()=>{if(pulling){again=true;return;}pulling=true;again=false;
apply(post,h,[serve===null?"B1":"B2:"+token]).then(a=>{pulling=false;
if(typeof a!=="string"||a==="S1"){if(again)pull();return;}
if(serve===null){const i=a.indexOf("\n");token=a.slice(0,i);try{serve=run(a.slice(i+1))();}catch(_){serve=null;}
if(typeof serve!=="function"){serve=null;apply(post,h,["E1"]).then(r=>{if(r==="Y1")pull();},()=>{});return;}}
else if(a!=="G1")return;
Promise.resolve().then(serve).then(pull,pull);},()=>{pulling=false;});};
addEventListener("pageshow",e=>{if(e.persisted)pull();},true);
pull();})();
