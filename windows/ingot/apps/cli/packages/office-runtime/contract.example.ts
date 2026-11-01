
import { OFFICE_RUNTIME_OUTPUTS, type OfficeRuntimeContract } from "./contract.ts";

export function examplePdfPlugin(): OfficeRuntimeContract {
  return {
    config: { title: { en: "PDF", "zh-CN": "PDF" }, kinds: ["pdf"] },
    outputs: OFFICE_RUNTIME_OUTPUTS,
  };
}
