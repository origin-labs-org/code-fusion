  // Probe-only witnesses from the exact native action target. No target keys or values leave this closure.
  const formQualificationCase = __FORM_CASE__;
  const formQualificationUrl = __FORM_URL__;
  let formQualificationBits = -1;
  let formQualificationTarget = null;
  let formQualificationTextTarget = null;
  let formQualificationNumberTarget = null;
  function formQualificationStart(request, target) {
    try {
    if (location.href !== formQualificationUrl) return;
    formQualificationBits = 1;
    if (request.k === "fill" && request.z === "Eval Sample") formQualificationBits |= 8;

    if (request.k === "fill" && request.z === "17") formQualificationBits |= 32;

    if (formQualificationCase === "form-expand-inputs") {
      const matches = document.querySelectorAll("#input-text");
      if (matches.length === 1 && matches[0] === target && target.tagName === "INPUT" && target.type === "text") {
        formQualificationBits |= 2;
        if (request.k === "fill" && request.z === "" && target === formQualificationTextTarget && target.value === "Eval Sample") formQualificationBits |= 16;
        formQualificationTarget = target;
      }
    } else if (formQualificationCase === "form-heroku-numeric") {
      const matches = document.querySelectorAll('input[type="number"]');
      if (matches.length === 1 && matches[0] === target) {
        formQualificationBits |= 4;
        if (request.k === "press" && request.pk === "arrow_up" && target === formQualificationNumberTarget && target.value === "17") formQualificationBits |= 64;
        formQualificationTarget = target;
      }
    }
    } catch (_) { formQualificationBits=0; formQualificationTarget=null; }
  }
  function formQualificationResult(result) {
    if (formQualificationBits < 0) return result;
    let bits = formQualificationBits;
    const target = formQualificationTarget;
    formQualificationBits = -1;
    formQualificationTarget = null;
    try { if (target !== null && target.isConnected && target.ownerDocument === document && location.href === formQualificationUrl) {
      const value = target.value;
      if (value === "Eval Sample") bits |= 128;
      if (value === "") bits |= 256;
      if (value === "17") bits |= 512;
      if (value === "18") bits |= 1024;
      if ((bits & 2) !== 0 && (bits & 8) !== 0 && value === "Eval Sample") formQualificationTextTarget = target;
      if ((bits & 4) !== 0 && (bits & 32) !== 0 && value === "17") formQualificationNumberTarget = target;
    } } catch (_) { bits=0; }
    return `FQ1:${bits}\n${result}`;
  }
