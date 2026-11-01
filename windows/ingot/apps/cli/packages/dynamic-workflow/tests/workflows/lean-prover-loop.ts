interface ImplUpdate {
  
  changed: string[];
  
  notes: string;
  
  buildOk: boolean;
}

interface Verdict {
  pass: boolean;
  
  proofPath?: string;
  
  counterExamples?: string[];
  
  reason: string;
}

const IMPL_PATH = "lean/Compress.lean";
const PROOF_PATH = "lean/CompressProof.lean";
const THEOREM = "∀ s, decompress (compress s) = s";

const programmer = agent("Programmer", {
  system:
    `你Yes Lean 4 工程师。Implementation写进 ${IMPL_PATH}，Deliver前必须用 lake build 自检。` +
    "Deliver the file itself. In the message, only describe changes; do not paste back the full source.",
});

const prover = agent("Prover", {
  system:
    `你Yes Lean 4 Form化验证专家。读 ${IMPL_PATH}，把证明写进 ${PROOF_PATH}，用 lake build 验证。` +
    "If unproven, pass=false and provide specific counterexamples; do not gloss over with 'sorry'.",
});

const MAX_ROUNDS = 10;

let impl = await programmer.ask<ImplUpdate>(
  `在 ${IMPL_PATH} MediumImplementation compress / decompress，TargetYes能证明 ${THEOREM}。`,
);
let verdict = await prover.ask<Verdict>(
  `请证明or证伪 ${THEOREM}。\nImplementation: ${impl.changed.join(", ")}\n` +
    `作者Description: ${impl.notes}\n自检: lake build ${impl.buildOk ? "Pass" : "未通过"}`,
);

let round = 1;
while (!verdict.pass && round < MAX_ROUNDS) {
  round = round + 1;
  log(`第 ${round} : ${verdict.counterExamples?.length ?? 0} 个反例`);
  impl = await programmer.ask<ImplUpdate>(
    `上One版Failed验证。\nReason: ${verdict.reason}\n` +
      `反例: ${JSON.stringify(verdict.counterExamples ?? [])}\n` +
      `请直接改 ${IMPL_PATH}（Failed的证明尝试见 ${PROOF_PATH}），改完 lake build 自检。`,
  );
  verdict = await prover.ask<Verdict>(
    `Implementation已更New（${impl.notes}）。请重New证明or证伪 ${THEOREM}。`,
  );
}

return {
  proved: verdict.pass,
  rounds: round,
  implPath: IMPL_PATH,
  proofPath: verdict.proofPath,
  verdict,
};
