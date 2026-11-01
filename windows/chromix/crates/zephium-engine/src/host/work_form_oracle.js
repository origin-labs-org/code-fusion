// Fixed read-only qualification observer. Called only in a private content world.
// No values, labels, page text, URLs, credentials or pixels leave this closure.
(() => {
  "use strict";
  const task = __FORM_ORACLE_CASE__;
  const urls = {
    "form-httpbin-draft": "https://httpbin.org/forms/post",
    "form-selenium-controls": "https://www.selenium.dev/selenium/web/web-form.html",
    "form-selenium-date": "https://www.selenium.dev/selenium/web/web-form.html",
    "form-expand-inputs": "https://practice.expandtesting.com/inputs",
    "form-heroku-numeric": "https://the-internet.herokuapp.com/inputs",
    "form-heroku-dropdown": "https://the-internet.herokuapp.com/dropdown",
    "form-heroku-checkboxes": "https://the-internet.herokuapp.com/checkboxes",
    "form-heroku-editor": "https://the-internet.herokuapp.com/tinymce",
    "form-qa-select": "https://demoqa.com/select-menu",
    "form-qa-date": "https://demoqa.com/date-picker"
  };
  const output = checks => {
    let no_task_submit = null;
    try {
      const receipt = globalThis.__zephiumPublicFormSubmitReceiptV1;
      if (typeof receipt === "function") {
        const value = receipt();
        if (typeof value === "boolean") no_task_submit = value;
      }
    } catch (_) { /* Missing or invalid event accounting stays unknown. */ }
    return JSON.stringify({version:1, checks, no_task_submit});
  };
  if (location.href !== urls[task]) return output([null]);
  const one = selector => {
    const nodes = document.querySelectorAll(selector);
    return nodes.length === 1 ? nodes[0] : null;
  };
  const value = (selector, expected) => {
    const node = one(selector);
    return node && (node instanceof HTMLInputElement || node instanceof HTMLSelectElement)
      ? node.value === expected : null;
  };
  const checked = (selector, expected) => {
    const node = one(selector);
    return node instanceof HTMLInputElement ? node.checked === expected : null;
  };
  const option = (selector, expected, label) => {
    const node = one(selector);
    if (!(node instanceof HTMLSelectElement) || node.selectedOptions.length !== 1) return null;
    const selected = node.selectedOptions[0];
    return node.value === expected && selected.textContent.trim() === label && !selected.disabled;
  };
  const date = selector => {
    const node = one(selector);
    if (!(node instanceof HTMLInputElement)) return null;
    // Only an observed HTML date type supplies an unambiguous native format.
    // Text widgets remain unknown until their actual format is independently bound.
    return node.type === "date" ? node.value === "2026-11-21" : null;
  };
  try {
    switch (task) {
      case "form-httpbin-draft":
        return output([
          value("input[name=custname]", "Eval Person"),
          checked("input[name=size][value=medium]", true),
          checked("input[name=topping][value=mushroom]", true),
          value("input[name=delivery]", "18:30"),
          value("input[name=custtel]", ""), value("input[name=custemail]", ""),
          checked("input[name=size][value=small]", false),
          checked("input[name=size][value=large]", false),
          checked("input[name=topping][value=bacon]", false),
          checked("input[name=topping][value=cheese]", false),
          checked("input[name=topping][value=onion]", false)
        ]);
      case "form-selenium-controls":
        return output([value("#my-text-id", "Eval Sample"), option("select[name=my-select]", "2", "Two"), checked("#my-check-2", false)]);
      case "form-selenium-date":
        return output([date("input[name=my-date]"), value("input[name=my-range]", "5")]);
      case "form-expand-inputs":
        // The required fill-then-clear sequence is not a final-state fact.
        return output([value("#input-number", "42"), value("#input-text", ""), null]);
      case "form-heroku-numeric":
        // A direct fill of18 does not prove the required increment-control action.
        return output([value("input[type=number]", "18"), null]);
      case "form-heroku-dropdown":
        return output([option("#dropdown", "2", "Option 2")]);
      case "form-heroku-checkboxes": {
        const nodes = document.querySelectorAll("#checkboxes input[type=checkbox]");
        return output(nodes.length === 2 ? [nodes[0].checked === true, nodes[1].checked === false] : [null, null]);
      }
      // Their rendered frame/group/locale bindings are not independently qualified.
      case "form-heroku-editor": case "form-qa-select": case "form-qa-date":
        return output([null]);
      default: return output([null]);
    }
  } catch (_) { return output([null]); }
})()
