import { expect, inject, test } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    formOracleRuntime: string;
    formSubmitRuntime: string;
    formActionRuntime: string;
  }
}

type Evidence = { version: number; checks: (boolean | null)[]; no_task_submit: boolean | null };
async function observe(task: string, href: string, body: string): Promise<Evidence> {
  const source = inject("formOracleRuntime").replace("__FORM_ORACLE_CASE__", JSON.stringify(task));
  const frame = document.createElement("iframe");
  const loaded = new Promise<void>((done) =>
    frame.addEventListener("load", () => done(), { once: true }),
  );
  // Actual browser DOM predicates; substitute only the native-owned URL operand.
  // Native origin/document ownership is independently checked by the host gate.
  frame.srcdoc = `${body}<script>
    const source = ${JSON.stringify(source)};
    const result = Function("location", "return (" + source + "\\n)")({href:${JSON.stringify(href)}});
    document.documentElement.dataset.evidence = result;
  </script>`;
  document.body.append(frame);
  try {
    await loaded;
    return JSON.parse(frame.contentDocument!.documentElement.dataset.evidence!) as Evidence;
  } finally {
    frame.remove();
  }
}

const httpbin =
  '<input name="custname" value="Eval Person"><input name="custtel"><input name="custemail"><input type="time" name="delivery" value="18:30"><input type="radio" name="size" value="small"><input type="radio" name="size" value="medium" checked><input type="radio" name="size" value="large"><input type="checkbox" name="topping" value="bacon"><input type="checkbox" name="topping" value="cheese"><input type="checkbox" name="topping" value="onion"><input type="checkbox" name="topping" value="mushroom" checked>';
test("fixed draft predicate checks every requested field and unchanged choice", async () => {
  const result = await observe("form-httpbin-draft", "https://httpbin.org/forms/post", httpbin);
  expect(result).toEqual({ version: 1, checks: Array(11).fill(true), no_task_submit: null });
  const wrong = await observe(
    "form-httpbin-draft",
    "https://httpbin.org/forms/post",
    httpbin.replace('value="bacon"', 'value="bacon" checked'),
  );
  expect(wrong.checks.filter((check) => check === false)).toHaveLength(1);
});
test("foreign and ambiguous pages cannot provide a passing predicate", async () => {
  expect(
    (await observe("form-httpbin-draft", "https://httpbin.org/private", httpbin)).checks,
  ).toEqual([null]);
  const ambiguous = await observe(
    "form-httpbin-draft",
    "https://httpbin.org/forms/post",
    `${httpbin}<input name="custname" value="Eval Person">`,
  );
  expect(ambiguous.checks[0]).toBeNull();
});
test("selected option value and visible label must both match", async () => {
  const body =
    '<input id="my-text-id" value="Eval Sample"><select name="my-select"><option value="1">One</option><option value="2" selected>Two</option></select><input type="checkbox" id="my-check-2">';
  expect(
    (
      await observe(
        "form-selenium-controls",
        "https://www.selenium.dev/selenium/web/web-form.html",
        body,
      )
    ).checks,
  ).toEqual([true, true, true]);
  expect(
    (
      await observe(
        "form-selenium-controls",
        "https://www.selenium.dev/selenium/web/web-form.html",
        body.replace(">Two<", ">Wrong<"),
      )
    ).checks,
  ).toEqual([true, false, true]);
});
test("final numeric and empty values never fabricate an action sequence", async () => {
  expect(
    (
      await observe(
        "form-heroku-numeric",
        "https://the-internet.herokuapp.com/inputs",
        '<input type="number" value="18">',
      )
    ).checks,
  ).toEqual([true, null]);
  expect(
    (
      await observe(
        "form-expand-inputs",
        "https://practice.expandtesting.com/inputs",
        '<input id="input-number" type="number" value="42"><input id="input-text">',
      )
    ).checks,
  ).toEqual([true, true, null]);
});
test("control values are reduced to booleans and never exported", async () => {
  const result = await observe(
    "form-expand-inputs",
    "https://practice.expandtesting.com/inputs",
    '<input id="input-number" value="42"><input id="input-text" value="synthetic-private-marker">',
  );
  expect(result.checks).toEqual([true, false, null]);
  expect(JSON.stringify(result)).not.toContain("synthetic-private-marker");
});
test("checkbox order and count are exact, date text stays unverified", async () => {
  expect(
    (
      await observe(
        "form-heroku-checkboxes",
        "https://the-internet.herokuapp.com/checkboxes",
        '<form id="checkboxes"><input type="checkbox" checked><input type="checkbox"></form>',
      )
    ).checks,
  ).toEqual([true, true]);
  expect(
    (
      await observe(
        "form-heroku-checkboxes",
        "https://the-internet.herokuapp.com/checkboxes",
        '<form id="checkboxes"><input type="checkbox" checked></form>',
      )
    ).checks,
  ).toEqual([null, null]);
  expect(
    (
      await observe(
        "form-selenium-date",
        "https://www.selenium.dev/selenium/web/web-form.html",
        '<input name="my-date" value="11/21/2026"><input type="range" name="my-range" min="0" max="10" value="5">',
      )
    ).checks,
  ).toEqual([null, true]);
});

async function runFixture(head: string, body: string, program: string): Promise<unknown> {
  const frame = document.createElement("iframe");
  const loaded = new Promise<void>((done) =>
    frame.addEventListener("load", () => done(), { once: true }),
  );
  frame.srcdoc = `<script>${head}</script>${body}<script>document.documentElement.dataset.evidence=JSON.stringify((()=>{${program}})());</script>`;
  document.body.append(frame);
  try {
    await loaded;
    return JSON.parse(frame.contentDocument!.documentElement.dataset.evidence!);
  } finally {
    frame.remove();
  }
}
function submitSource() {
  return inject("formSubmitRuntime").replace(
    "__FORM_URL__",
    JSON.stringify("https://httpbin.org/forms/post"),
  );
}
const bindSubmit = () =>
  `Function("location", ${JSON.stringify(submitSource())})({href:"https://httpbin.org/forms/post"});`;
test("document-start passive receipt observes prevented submits without navigation", async () => {
  const result = await runFixture(
    bindSubmit(),
    "<form><button>Go</button></form>",
    `
    let fetched=0;
    document.querySelector("form").addEventListener("submit",event=>{event.preventDefault();fetched++;void fetch("data:text/plain,synthetic-form-handler");});
    document.querySelector("button").click();
    return {no_submit:globalThis.__zephiumPublicFormSubmitReceiptV1(), fetched, still_here:true};`,
  );
  expect(result).toEqual({ no_submit: false, fetched: 1, still_here: true });
  expect(
    await runFixture(
      bindSubmit(),
      "<form></form>",
      "return globalThis.__zephiumPublicFormSubmitReceiptV1();",
    ),
  ).toBe(true);
});
test("missing, late, overflowing and child-frame submit coverage stay unknown", async () => {
  expect(
    (await observe("form-httpbin-draft", "https://httpbin.org/forms/post", httpbin)).no_task_submit,
  ).toBeNull();
  expect(
    await runFixture(
      bindSubmit(),
      "<form></form>",
      `for(let i=0;i<257;i++)document.querySelector("form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));return globalThis.__zephiumPublicFormSubmitReceiptV1();`,
    ),
  ).toBeNull();
  expect(
    await runFixture(
      bindSubmit(),
      "<iframe></iframe>",
      "return globalThis.__zephiumPublicFormSubmitReceiptV1();",
    ),
  ).toBeNull();
  expect(
    await runFixture(
      "",
      "",
      `const source=${JSON.stringify(submitSource())};Object.defineProperty(document,"readyState",{value:"complete"});Function("location",source)({href:"https://httpbin.org/forms/post"});return globalThis.__zephiumPublicFormSubmitReceiptV1();`,
    ),
  ).toBeNull();
});
test("target witnesses bind exact synthetic values and cannot replay a prior action", async () => {
  const helper = inject("formActionRuntime")
    .replace("__FORM_CASE__", JSON.stringify("form-expand-inputs"))
    .replace("__FORM_URL__", JSON.stringify("https://practice.expandtesting.com/inputs"));
  const result = await runFixture(
    "",
    '<input id="input-text"><input id="other">',
    `
    return Function("location",${JSON.stringify(
      helper +
        `
      const target=document.querySelector("#input-text");
      formQualificationStart({k:"fill",z:"Eval Sample"},target);target.value="Eval Sample";
      const first=formQualificationResult("{}");
      const duplicate=formQualificationResult("{}");
      formQualificationBits=0;formQualificationStart({k:"fill",z:""},document.querySelector("#other"));
      const foreign=formQualificationResult("{}");
      formQualificationBits=0;formQualificationStart({k:"fill",z:""},target);target.value="";
      return [first,duplicate,foreign,formQualificationResult("{}")];
    `,
    )})({href:"https://practice.expandtesting.com/inputs"});`,
  );
  expect(result).toEqual(["FQ1:139\n{}", "{}", "FQ1:1\n{}", "FQ1:275\n{}"]);
});

test("a transient removed frame leaves sticky unknown submit coverage", async () => {
  expect(
    await runFixture(
      bindSubmit(),
      "<div></div>",
      `
    const frame=document.createElement("iframe");
    document.querySelector("div").append(frame);
    frame.contentDocument.body.innerHTML="<form><button>Submit</button></form>";
    frame.contentDocument.querySelector("form").addEventListener("submit",event=>{event.preventDefault();void fetch("data:text/plain,synthetic-child-handler");});
    frame.contentDocument.querySelector("button").click();
    frame.remove();
    return globalThis.__zephiumPublicFormSubmitReceiptV1();
  `,
    ),
  ).toBeNull();
});
test("replacing a target cannot inherit a prior fill witness", async () => {
  const helper = inject("formActionRuntime")
    .replace("__FORM_CASE__", JSON.stringify("form-expand-inputs"))
    .replace("__FORM_URL__", JSON.stringify("https://practice.expandtesting.com/inputs"));
  const result = await runFixture(
    "",
    '<input id="input-text">',
    `return Function("location",${JSON.stringify(
      helper +
        `
    const original=document.querySelector("#input-text");
    formQualificationStart({k:"fill",z:"Eval Sample"},original);original.value="Eval Sample";formQualificationResult("{}");
    const replacement=original.cloneNode();replacement.value="Eval Sample";original.replaceWith(replacement);
    formQualificationBits=0;formQualificationStart({k:"fill",z:""},replacement);replacement.value="";
    return formQualificationResult("{}");
  `,
    )})({href:"https://practice.expandtesting.com/inputs"});`,
  );
  expect(result).toBe("FQ1:259\n{}");
});

test("open shadow attached to an already inspected host cannot qualify no-submit", async () => {
  expect(
    await runFixture(
      bindSubmit(),
      '<div id="host"></div>',
      `
    globalThis.__zephiumPublicFormSubmitReceiptV1();
    const root=document.querySelector("#host").attachShadow({mode:"open"});
    root.innerHTML="<form><button>Submit</button></form>";
    root.querySelector("form").addEventListener("submit",event=>event.preventDefault());
    root.querySelector("button").click();
    return globalThis.__zephiumPublicFormSubmitReceiptV1();
  `,
    ),
  ).toBeNull();
});
