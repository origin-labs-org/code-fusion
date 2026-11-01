import { expect, inject, test } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    semanticMediaRuntime: string;
  }
}
type Node = {
  k: number;
  r: string;
  n?: string;
  t?: string;
  m?: string;
  b?: { x: number; y: number; w: number; h: number };
};
type Media = { k: number; t: string; r: number[]; l: boolean };
type Snapshot = { n: Node[]; m?: Media[] };
const pixel = (color: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="110"><rect width="160" height="110" fill="${color}"/></svg>`)}`;
async function capture(
  body: string,
  nodes = 128,
  source = inject("semanticMediaRuntime"),
): Promise<Snapshot> {
  const frame = document.createElement("iframe");
  frame.width = "800";
  frame.height = "600";
  const loaded = new Promise<void>((done) =>
    frame.addEventListener("load", () => done(), { once: true }),
  );
  frame.srcdoc = `<style>body{margin:8px}main{display:flex;gap:16px}article{width:200px}img,video,canvas,.photo{display:block;width:160px;height:110px}h2{font:16px sans-serif}</style>${body}<script>${source}
  addEventListener("load", () => {
    const api=globalThis.__zephiumSemanticRuntimeV1;
    const b={n:${nodes},t:${nodes > 128 ? 32768 : 16384},w:${nodes > 128 ? 131072 : 65536},x:${nodes > 128 ? 16384 : 4096},geo:true};
    const first=JSON.parse(api.invoke(JSON.stringify({v:1,i:1,g:1,s:{k:"initial"},b})));
    const result=api.invoke(JSON.stringify({v:1,i:2,g:2,s:{k:"subtree",a:first.n[0].k},b}));
    document.documentElement.dataset.capture=result;
  });</script>`;
  document.body.append(frame);
  try {
    await loaded;
    const value = frame.contentDocument?.documentElement.dataset.capture;
    expect(value?.startsWith("{"), value).toBe(true);
    return JSON.parse(value!) as Snapshot;
  } finally {
    frame.remove();
  }
}

test("blank or misleading image labels never decide which named card owns a picture", async () => {
  const snapshot = await capture(`<main>
    <article><img alt="Beta" src="${pixel("red")}"><h2>Alpha</h2><p>First listing</p></article>
    <article><img alt="" src="${pixel("blue")}"><h2>Beta</h2><p>Second listing</p></article>
    <article><img src="${pixel("green")}"><h2>Gamma</h2><p>Third listing</p></article>
  </main>`);
  const headings = snapshot.n.filter((node) => node.r === "heading");
  expect(headings.map((node) => node.n)).toEqual(["Alpha", "Beta", "Gamma"]);
  const pictures = snapshot.n.filter((node) => node.r === "image");
  expect(pictures).toHaveLength(3);
  for (const [index, heading] of headings.entries()) {
    const media = snapshot.m?.find((item) => item.k === pictures[index]?.k);
    expect(media?.r).toContain(heading.k);
    expect(media?.r.filter((key) => headings.some((other) => other.k === key))).toEqual([
      heading.k,
    ]);
  }
});

test("CSS photos, native picture selection, and observed video posters remain distinct media", async () => {
  const snapshot = await capture(`<main>
    <article><div class="photo" style="background-image:url('${pixel("purple")}')"></div><h2>CSS listing</h2></article>
    <article><picture><source srcset="${pixel("orange")}"><img alt="" src="${pixel("black")}"></picture><h2>Responsive listing</h2></article>
    <article><video poster="${pixel("yellow")}"></video><h2>Video listing</h2></article>
  </main>`);
  expect(
    snapshot.m
      ?.filter((item) => item.t !== "record")
      .map((item) => item.t)
      .sort(),
  ).toEqual(["background", "image", "poster"]);
  expect(snapshot.m?.every((item) => item.r.length > 0)).toBe(true);
});

test("a missing card photo cannot borrow a sibling card's image through the shared grid", async () => {
  const snapshot = await capture(`<main><div style="display:flex;gap:16px">
    <article><img alt="Beta" src="${pixel("red")}"><h2>Alpha</h2></article>
    <article><h2>Beta</h2><p>This card has no picture.</p></article>
  </div></main>`);
  const alpha = snapshot.n.find((node) => node.r === "heading" && node.n === "Alpha")!;
  const beta = snapshot.n.find((node) => node.r === "heading" && node.n === "Beta")!;
  const photos = snapshot.m?.filter((item) => item.t !== "record");
  expect(photos).toHaveLength(1);
  expect(photos![0]!.r).toContain(alpha.k);
  expect(photos![0]!.r).not.toContain(beta.k);
});

test("a larger observed image is sanitized before crossing the bounded native result channel", async () => {
  const frame = document.createElement("iframe");
  frame.width = "800";
  frame.height = "600";
  const loaded = new Promise<void>((done) =>
    frame.addEventListener("load", () => done(), { once: true }),
  );
  frame.srcdoc = `<article><img alt="" style="width:320px;height:240px"><h2>Observed image</h2></article><script>${inject("semanticMediaRuntime")}
    addEventListener("load", async () => {
      try {
        const canvas=document.createElement("canvas");canvas.width=640;canvas.height=480;
        const ctx=canvas.getContext("2d"),data=ctx.createImageData(640,480);let seed=42;
        for(let i=0;i<data.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data.data[i]=seed&255;data.data[i+1]=seed>>>8&255;data.data[i+2]=seed>>>16&255;data.data[i+3]=255;}
        ctx.putImageData(data,0,0);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.9));
        const image=document.querySelector("img"),url=URL.createObjectURL(blob);image.setAttribute("data-src",url);
        const api=globalThis.__zephiumSemanticRuntimeV1,b={n:128,t:16384,w:65536,x:4096,geo:true};
        const first=JSON.parse(api.invoke(JSON.stringify({v:1,i:1,g:1,s:{k:"initial"},b})));
        const snapshot=JSON.parse(api.invoke(JSON.stringify({v:1,i:2,g:2,s:{k:"subtree",a:first.n[0].k},b})));
        const heading=snapshot.n.find(node=>node.r==="heading"),media=snapshot.m.find(item=>item.r.includes(heading.k));
        image.src=url;await image.decode();
        const result=JSON.parse(await api.invoke("M1:"+JSON.stringify({i:2,g:2,k:media.k,n:heading.k})));
        let width=0,height=0,bytes=0;
        if(result.s==="fetch") {const raw=Uint8Array.from(atob(result.bytes),c=>c.charCodeAt(0));bytes=raw.length;const picture=await createImageBitmap(new Blob([raw],{type:"image/png"}));width=picture.width;height=picture.height;picture.close();}
        const replacement=URL.createObjectURL(blob);image.src=replacement;await image.decode();
        const stale=JSON.parse(await api.invoke("M1:"+JSON.stringify({i:2,g:2,k:media.k,n:heading.k})));
        URL.revokeObjectURL(url);URL.revokeObjectURL(replacement);document.documentElement.dataset.result=JSON.stringify({source:blob.size,status:result.s,stale:stale.s,bytes,width,height});
      }catch(error){document.documentElement.dataset.result=JSON.stringify({error:String(error)});}
    });</script>`;
  document.body.append(frame);
  try {
    await loaded;
    await expect.poll(() => frame.contentDocument?.documentElement.dataset.result).toBeTruthy();
    const result = JSON.parse(frame.contentDocument!.documentElement.dataset.result!);
    expect(result.error).toBeUndefined();
    expect(result.source).toBeGreaterThan(65536);
    expect(result.source).toBeLessThanOrEqual(524288);
    expect(result.status).toBe("fetch");
    expect(result.stale).toBe("unavailable");
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.bytes).toBeLessThanOrEqual(65536);
    expect(result.width).toBeLessThanOrEqual(320);
    expect(result.height).toBeLessThanOrEqual(240);
  } finally {
    frame.remove();
  }
});

test("paragraph and link-only cards own their image and a photo-less peer cannot borrow it", async () => {
  for (const tag of ["article", "div"]) {
    const snapshot = await capture(`<main><div style="display:flex;gap:16px">
      <${tag} style="width:200px"><img alt="" src="${pixel("red")}"><a href="https://example.test/alpha">Alpha</a><p>First listing</p></${tag}>
      <${tag} style="width:200px"><a href="https://example.test/beta">Beta</a><p>Missing photo</p></${tag}>
    </div></main>`);
    const alpha = snapshot.n.find((node) => node.r === "link" && node.n === "Alpha")!;
    const beta = snapshot.n.find((node) => node.r === "link" && node.n === "Beta")!;
    const photos = snapshot.m?.filter((item) => item.t !== "record");
    expect(photos).toHaveLength(1);
    expect(photos![0]!.r).toContain(alpha.k);
    expect(photos![0]!.r).not.toContain(beta.k);
  }
});

test("explicit text-only records have separate native rectangles, never a shared grid or page", async () => {
  const snapshot = await capture(`<main>
    <article style="height:140px"><h2>Amber record</h2><p>First description</p></article>
    <article style="height:140px"><h2>Blue record</h2><p>Second description</p></article>
  </main>`);
  const records = snapshot.m?.filter((item) => item.t === "record");
  expect(records).toHaveLength(2);
  for (const [index, name] of ["Amber record", "Blue record"].entries()) {
    const heading = snapshot.n.find((node) => node.r === "heading" && node.n === name)!;
    const other = snapshot.n.find((node) => node.r === "heading" && node.n !== name)!;
    expect(records![index]!.r).toContain(heading.k);
    expect(records![index]!.r).not.toContain(other.k);
  }
  for (const body of [
    '<article style="height:140px"><h2>Grid</h2><div><p>One record</p></div><div><p>Another record</p></div></article>',
    '<article style="height:140px"><h2>One record</h2><h2>Another record</h2></article>',
    '<article style="width:790px;height:590px"><h2>Whole page</h2><p>Content</p></article>',
  ]) {
    const refused = await capture(body);
    expect(refused.m?.filter((item) => item.t === "record") ?? []).toHaveLength(0);
  }
});

test("a bounded busy listing preserves completed same-card associations", async () => {
  const cards = Array.from(
    { length: 24 },
    (_, index) =>
      `<div style="width:200px;flex:none"><img alt="" src="${pixel("red")}"><h2>Listing ${index}</h2>${Array.from({ length: 8 }, (_, field) => `<p>Detail ${index} ${field}</p>`).join("")}</div>`,
  ).join("");
  const snapshot = await capture(
    `<main><section style="display:flex">${cards}</section></main>`,
    320,
  );
  expect(snapshot.n.filter((node) => node.r === "image").length).toBeGreaterThan(12);
  const first = snapshot.n.find((node) => node.r === "heading" && node.n === "Listing 0")!;
  expect(snapshot.m?.some((item) => item.r.includes(first.k))).toBe(true);
});

test("deep repeated listing wrappers cannot erase already checked card images at the work cap", async () => {
  const cards = Array.from({ length: 16 }, (_, index) => {
    let detail = `<h2>Deep listing ${index}</h2>${Array.from({ length: 6 }, (_, field) => `<p>Detail ${index} ${field}</p>`).join("")}`;
    for (let depth = 0; depth < 5; depth++) detail = `<div>${detail}</div>`;
    return `<article style="width:200px;flex:none"><img alt="" src="${pixel("red")}">${detail}</article>`;
  }).join("");
  const snapshot = await capture(
    `<main><section style="display:flex">${cards}</section></main>`,
    320,
  );
  const first = snapshot.n.find((node) => node.r === "heading" && node.n === "Deep listing 0")!;
  expect(first).toBeDefined();
  expect(snapshot.m?.some((item) => item.t === "image" && item.r.includes(first.k))).toBe(true);
});

test("record labels stop child iteration at the existing stack bound", async () => {
  const original = inject("semanticMediaRuntime");
  const anchor = "Object.freeze({evidence,invoke})";
  expect(original.split(anchor)).toHaveLength(2);
  const fixed = original.replace(anchor, "Object.freeze({evidence,invoke,testLabel:label})");
  const frame = document.createElement("iframe");
  const loaded = new Promise<void>((done) =>
    frame.addEventListener("load", () => done(), { once: true }),
  );
  frame.srcdoc = `<script>${fixed}
    const label=globalThis.__zephiumRecordMediaV1.testLabel;
    let iterated=0,refused=false,threw=false;
    const node=count=>({nodeType:1,getAttribute:()=>"",childNodes:new Proxy({},{get:(_,key)=>{if(key==="length")return count;if(++iterated>1000)throw new Error();return {nodeType:3,nodeValue:"x"};}})});
    const accepted=label(node(63))==="x".repeat(63)+"|";
    iterated=0;try{refused=label(node(1000000))===null;}catch(_){threw=true;}
    document.documentElement.dataset.result=JSON.stringify({accepted,refused,threw,iterated});
  </script>`;
  document.body.append(frame);
  try {
    await loaded;
    const result = JSON.parse(frame.contentDocument!.documentElement.dataset.result!);
    expect(result).toEqual({
      accepted: true,
      refused: true,
      threw: false,
      iterated: 64,
    });
  } finally {
    frame.remove();
  }
});

test("paragraph inheritance needs its own proven single-image link and keeps all fences", async () => {
  const image = `<img alt="" src="${pixel("red")}">`;
  const fields = "<div><div><p>Alpha record</p></div><div><p>Price 20</p></div></div>";
  const link = (body: string) => `<a href="https://example.test/alpha">${body}</a>`;
  const fixtures: [string, string, boolean][] = [
    [
      "nested fields",
      `<article>${link(image + fields)}</article><article><p>Beta record</p><p>Missing photo</p></article>`,
      true,
    ],
    [
      "no link proof",
      `<article>${image + fields}</article><article><p>Beta record</p></article>`,
      false,
    ],
    [
      "explicit nested records",
      link(`<article>${image}<p>Other record</p></article><article>${fields}</article>`),
      false,
    ],
    [
      "generic peer with image",
      link(
        `<div style="display:flex"><div>${image}<p>Other record</p></div><div>${fields}</div></div>`,
      ),
      false,
    ],
    [
      "unproved link boundary",
      `<article>${link(image + '<div role="link">' + fields + "</div>")}</article>`,
      false,
    ],
    ["multiple native images", `<article>${link(image + image + fields)}</article>`, false],
    [
      "own image outside, peer inside",
      `<article>${link(image.replace("<img ", '<img style="position:absolute;left:500px" ') + fields)}${image}</article>`,
      false,
    ],
    [
      "outside proven geometry",
      `<article>${link(image + '<div><div style="position:absolute;left:480px"><p>Alpha record</p></div><div><p>Price 20</p></div></div>')}</article>`,
      false,
    ],
    [
      "low node budget",
      `<article>${link(image + fields + Array.from({ length: 20 }, () => '<p style="display:inline">x</p>').join("") + image).replace("<a ", '<a style="display:block" ')}</article>`,
      false,
    ],
    [
      "open shadow",
      `<article>${link(image + fields + '<div id="shadowhost"></div>')}</article><script>document.getElementById("shadowhost").attachShadow({mode:"open"}).textContent="fixture";</script>`,
      false,
    ],
    [
      "foreign subtree",
      `<article>${link(image + fields + '<iframe srcdoc="" width="1" height="1"></iframe>')}</article>`,
      false,
    ],
    [
      "opaque custom host",
      `<article>${link(image + fields + "<fixture-opaque></fixture-opaque>")}</article>`,
      false,
    ],
    [
      "subtree exhausted",
      `<article>${link(image + fields + Array.from({ length: 80 }, () => "<span hidden></span>").join("")).replace("<a ", '<a aria-label="Alpha record" ')}</article>`,
      false,
    ],
    [
      "pseudo visual",
      `<style>a::before{content:"";display:block;width:80px;height:80px;background-image:url("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")}</style><article>${link(image + fields)}</article>`,
      false,
    ],
    ["work exhausted", `<article>${link(image + fields)}</article>`, false],
    [
      "reference cap",
      `<article>${link(image + fields + Array.from({ length: 7 }, (_, i) => `<p>Existing ${i}</p>`).join(""))}</article>`,
      false,
    ],
    [
      "photo-less linked peer",
      `<div style="display:flex"><div style="width:200px">${link(image + fields)}</div><div style="width:200px"><a href="https://example.test/beta"><div><p>Beta record</p></div><div><p>No image</p></div></a></div></div>`,
      true,
    ],
  ];
  for (const [name, body, expected] of fixtures) {
    let source = inject("semanticMediaRuntime");
    if (name === "work exhausted") {
      const anchor = "    inheritance: for";
      expect(source.split(anchor), name).toHaveLength(2);
      source = source.replace(anchor, "    work=16384;\n    inheritance: for");
    }
    const snapshot = await capture(body, name === "low node budget" ? 8 : 128, source);
    const alpha = snapshot.n.find((node) => node.r === "paragraph" && node.t === "Alpha record");
    const beta = snapshot.n.find((node) => node.r === "paragraph" && node.t === "Beta record");
    const images = snapshot.m?.filter((item) => item.t === "image") ?? [];
    if (name === "low node budget") {
      expect(images, name).toHaveLength(1);
      const links = snapshot.n.filter((node) => node.r === "link");
      expect(
        images.some((item) => links.some((node) => item.r.includes(node.k))),
        name,
      ).toBe(true);
    }
    expect(alpha, name).toBeDefined();
    expect(
      images.some((item) => item.r.includes(alpha!.k)),
      name,
    ).toBe(expected);
    if (beta)
      expect(
        images.some((item) => item.r.includes(beta.k)),
        name,
      ).toBe(false);
    expect(
      images.every((item) => item.r.length <= 8),
      name,
    ).toBe(true);
  }
});
