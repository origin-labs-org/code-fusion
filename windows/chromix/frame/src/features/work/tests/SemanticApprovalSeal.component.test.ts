import { expect, inject, test } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    semanticMediaRuntime: string;
  }
}
type Result = {
  result: string;
  clicks: number;
  focusDelta: number;
  selected: number;
  proofPresent: boolean;
  currentProof: boolean;
  sameKey?: boolean;
};
async function sealedScenario(scenario: string): Promise<Result> {
  const frame = document.createElement("iframe");
  frame.width = "800";
  frame.height = "600";
  const entropy =
    scenario === "missing"
      ? 'Object.defineProperty(globalThis,"crypto",{value:undefined});'
      : scenario === "zero"
        ? 'Object.defineProperty(globalThis,"crypto",{value:{getRandomValues(bytes){return bytes;}}});'
        : scenario === "constant" || scenario === "cycle"
          ? `let randomCalls=0;Object.defineProperty(globalThis,"crypto",{value:{getRandomValues(bytes){randomCalls++;bytes.fill(${scenario === "constant" ? "1" : "randomCalls===2?2:1"});return bytes;}}});`
          : "";
  frame.srcdoc = `<button id="a">Send</button><button id="b">Send</button><select aria-label="Mode"><option>First</option><option>Second</option></select><script>
    ${entropy}
    let pull=null,parks=0;
    Object.defineProperty(globalThis,"webkit",{value:{messageHandlers:{zephiumSemanticRuntimeV1:{postMessage(message){if(message==="P1")return new Promise(resolve=>pull=resolve);if(message==="K1:A"){parks++;return Promise.resolve("A1");}throw new Error("unexpected synthetic channel");}}}}});
  </script><script>${inject("semanticMediaRuntime")}
  addEventListener("load",async()=>{try{
    const scenario=${JSON.stringify(scenario)},api=globalThis.__zephiumSemanticRuntimeV1;
    let cursor=0,attempt=0,clicks=0,focus=0;
    document.addEventListener("click",e=>{if(e.target.tagName==="BUTTON")clicks++;});
    document.addEventListener("focus",()=>focus++,true);
    const capture=()=>JSON.parse(api.invoke(JSON.stringify({v:1,i:++cursor,g:cursor,s:{k:"initial"},b:{n:128,t:16384,w:65536,x:4096,geo:true}})));
    const buttons=look=>look.n.filter(n=>n.r==="button");
    const descriptor=n=>({...(n.ak===undefined?{}:{a:n.ak}),r:{button:7,combobox:13,option:15}[n.r],o:n.o||0,q:n.q==="sensitive"?2:1,s:n.s||0,n:n.n??null,vk:n.v?.k==="text"?1:n.v?.k==="boolean"?3:n.v?.k==="ordinal"?4:0,vt:n.v?.k==="text"?n.v.value:null,vo:n.v?.k==="ordinal"?n.v.value:0,vb:n.v?.k==="boolean"?n.v.value:false});
    const action=(look,target,proof,option)=>(scenario.startsWith("cdp_")?api.prepareCdpAction:api.invoke)(JSON.stringify({v:1,o:"action_execute",a:++attempt,i:look.i,g:look.g,t:target.k,r:target.r,k:option?"select":"click",e:target.b,p:option?.k??0,z:null,f:descriptor(target),of:option?descriptor(option):null,...(proof===undefined?{}:{ap:proof})}));
    const park=async()=>{const previous=parks;if(!pull)throw new Error("missing pull");const next=pull;pull=null;next("K1");for(let i=0;i<30;i++)await Promise.resolve();if(parks!==previous+1)throw new Error("missing park ack");dispatchEvent(new Event("pageshow"));for(let i=0;i<10;i++)await Promise.resolve();};
    let look=capture(),target=buttons(look)[0],option;
    let proof=[look.ap??"11111111111111111111111111111111",target.ai??1,null];
    const proofPresent=typeof look.ap==="string"&&target.ai!==undefined;
    const originalKey=target.k;
    if(scenario==="same") {const p=document.createElement("p");p.textContent="Unrelated row";document.querySelector("#a").before(p);look=capture();target=buttons(look)[0];}
    if(scenario==="sibling") {look=capture();target=buttons(look)[1];}
    if(["replacement","stale","prior_rebind","generic_rebind"].includes(scenario)){
      const old=document.querySelector("#a");old.replaceWith(old.cloneNode(true));
      if(scenario==="prior_rebind")await action(look,target,undefined);
      if(scenario==="replacement"||scenario==="prior_rebind"){look=capture();target=buttons(look)[0];}
      if(scenario==="generic_rebind")proof=undefined;
    }
    if(scenario==="park"||scenario==="constant"||scenario==="cycle"){
      await park();if(scenario!=="park")await park();if(scenario==="cycle")await park();
      look=capture();target=buttons(look)[0];
    }
    if(scenario==="option"||scenario==="option_missing"){
      target=look.n.find(n=>n.r==="combobox");const options=look.n.filter(n=>n.r==="option");
      proof=[look.ap,target.ai,options[0].ai];option=options[1];
      if(scenario==="option_missing")proof[2]=null;
    }
    if(scenario==="malformed")proof=["not-a-nonce",1,null];
    if(scenario==="stale_checkpoint")capture();
    if(scenario==="exhausted"){
      for(let i=0;i<2048;i++){const old=document.querySelector("#a");old.replaceWith(old.cloneNode(true));look=capture();}
      target=buttons(look)[0];
    }
    const beforeFocus=focus;
    let result=await action(look,target,proof,option);
    if(scenario.startsWith("cdp_")) {
      if(!result.startsWith("P2:"))throw new Error("missing fixed CDP plan");
      const plan=JSON.parse(result.slice(3));
      if(scenario==="cdp_replacement") {const old=document.querySelector("#a");old.replaceWith(old.cloneNode(true));}
      if(scenario==="cdp_park")await park();
      result=await api.nextCdpAction(plan.a,1,scenario==="cdp_cancel");
    }
    document.documentElement.dataset.summary=JSON.stringify({result,clicks,focusDelta:focus-beforeFocus,selected:document.querySelector("select").selectedIndex,proofPresent,currentProof:typeof look.ap==="string"&&target.ai!==undefined,sameKey:target.k===originalKey});
  }catch(error){document.documentElement.dataset.error=String(error);}});</script>`;
  document.body.append(frame);
  try {
    await expect
      .poll(
        () =>
          frame.contentDocument?.documentElement.dataset.summary ??
          frame.contentDocument?.documentElement.dataset.error,
        { timeout: 20000 },
      )
      .toBeTruthy();
    expect(frame.contentDocument!.documentElement.dataset.error).toBeUndefined();
    return JSON.parse(frame.contentDocument!.documentElement.dataset.summary!) as Result;
  } finally {
    frame.remove();
  }
}

test("original private approval survives unchanged same-page recapture", async () => {
  const result = await sealedScenario("same");
  expect(result.proofPresent).toBe(true);
  expect(result.result.startsWith("{")).toBe(true);
  expect(result.clicks).toBe(1);
});

test.each([
  "sibling",
  "replacement",
  "stale",
  "park",
  "option",
  "option_missing",
  "malformed",
  "stale_checkpoint",
])("private approval refuses %s before focus or effect", async (scenario) => {
  const result = await sealedScenario(scenario);
  if (scenario === "option_missing" || scenario === "malformed")
    expect(result.result).toBe("E1:invalid_request");
  else expect(result.result.startsWith("E2:")).toBe(true);
  expect(result.clicks).toBe(0);
  expect(result.focusDelta).toBe(0);
  expect(result.selected).toBe(0);
});

test("generic read rebind remains available but cannot transfer approval", async () => {
  const generic = await sealedScenario("generic_rebind");
  expect(generic.result.startsWith("{")).toBe(true);
  expect(generic.clicks).toBe(1);
  const sealed = await sealedScenario("prior_rebind");
  expect(sealed.sameKey).toBe(true);
  expect(sealed.result.startsWith("E2:")).toBe(true);
  expect(sealed.clicks).toBe(1);
  expect(sealed.focusDelta).toBe(0);
});

test.each(["missing", "zero", "constant", "cycle"])(
  "private approval entropy %s fails closed without resurrection",
  async (scenario) => {
    const result = await sealedScenario(scenario);
    expect(result.currentProof).toBe(false);
    expect(result.result.startsWith("E2:")).toBe(true);
    expect(result.clicks).toBe(0);
    expect(result.focusDelta).toBe(0);
  },
);

test("private element identity allocation is bounded and exhaustion never falls back", async () => {
  const result = await sealedScenario("exhausted");
  expect(result.currentProof).toBe(false);
  expect(result.result.startsWith("E2:")).toBe(true);
  expect(result.clicks).toBe(0);
  expect(result.focusDelta).toBe(0);
}, 25000);

test.each(["cdp_replacement", "cdp_park", "cdp_cancel"])(
  "queued CDP approval refuses %s before any input dispatch",
  async (scenario) => {
    const result = await sealedScenario(scenario);
    expect(result.result.startsWith("E2:")).toBe(true);
    expect(result.clicks).toBe(0);
    expect(result.focusDelta).toBe(0);
  },
);

test("real document replacement cannot reuse an original private approval", async () => {
  const frame = document.createElement("iframe");
  frame.width = "800";
  frame.height = "600";
  const body = `<button>Send</button><script>${inject("semanticMediaRuntime")}</script>`;
  const load = () =>
    new Promise<void>((done) => frame.addEventListener("load", () => done(), { once: true }));
  type Api = { invoke(input: string): string | Promise<string> };
  const api = () =>
    (frame.contentWindow as unknown as { __zephiumSemanticRuntimeV1: Api })
      .__zephiumSemanticRuntimeV1;
  const capture = async () =>
    JSON.parse(
      await api().invoke(
        JSON.stringify({
          v: 1,
          i: 1,
          g: 1,
          s: { k: "initial" },
          b: { n: 128, t: 16384, w: 65536, x: 4096, geo: true },
        }),
      ),
    ) as {
      ap: string;
      n: Array<{ k: number; ai: number; r: string; o: number; n: string; b: unknown }>;
    };
  let loaded = load();
  frame.srcdoc = body;
  document.body.append(frame);
  try {
    await loaded;
    const first = await capture(),
      original = first.n.find((n) => n.r === "button")!;
    const firstDocument = frame.contentDocument;
    loaded = load();
    frame.srcdoc = body;
    await loaded;
    const current = await capture(),
      target = current.n.find((n) => n.r === "button")!;
    expect(frame.contentDocument).not.toBe(firstDocument);
    expect(target.k).toBe(original.k);
    expect(current.ap === first.ap).toBe(false);
    let clicks = 0;
    frame.contentDocument!.addEventListener("click", () => clicks++);
    const result = await api().invoke(
      JSON.stringify({
        v: 1,
        o: "action_execute",
        a: 1,
        i: 1,
        g: 1,
        t: target.k,
        r: "button",
        k: "click",
        e: target.b,
        p: 0,
        z: null,
        f: { r: 7, o: target.o, q: 1, s: 0, n: target.n, vk: 0, vt: null, vo: 0, vb: false },
        of: null,
        ap: [first.ap, original.ai, null],
      }),
    );
    expect(result).toBe("E2:target_changed");
    expect(clicks).toBe(0);
    expect(frame.contentDocument!.activeElement?.tagName).not.toBe("BUTTON");
  } finally {
    frame.remove();
  }
});
