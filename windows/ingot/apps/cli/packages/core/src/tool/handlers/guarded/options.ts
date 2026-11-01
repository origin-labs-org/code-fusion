import type { CommandWord } from "./word.js";

export type OptionArity = "flag" | "value" | "optional";
export type OptionTable = Readonly<Record<string, OptionArity>>;
export interface ParsedOptions {
  flags: string[];
  operands: CommandWord[];
  unsupported: boolean;
}

export interface OptionScanPolicy {
  ordering: "stop-at-operand" | "interspersed";
  unknown: "abort" | "continue";
}

export const WRAPPER_SCAN: OptionScanPolicy = {
  ordering: "stop-at-operand",
  unknown: "abort",
};
export const COMMAND_SCAN: OptionScanPolicy = {
  ordering: "interspersed",
  unknown: "continue",
};

export function parseOptions(
  words: CommandWord[],
  table: OptionTable,
  policy: OptionScanPolicy,
): ParsedOptions {
  const result: ParsedOptions = { flags: [], operands: [], unsupported: false };
  let ended = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (!ended && !word.dynamic && word.value === "--") {
      ended = true;
      continue;
    }
    if (ended || word.dynamic || !word.value.startsWith("-") || word.value === "-") {
      result.operands.push(word);
      if (policy.ordering === "stop-at-operand") {
        result.operands.push(...words.slice(i + 1));
        break;
      }
      continue;
    }
    const long = word.value.startsWith("--");
    const equals = word.value.indexOf("=");
    const names = long
      ? [equals < 0 ? word.value : word.value.slice(0, equals)]
      : Array.from(word.value.slice(1), (c) => `-${c}`);
    for (let n = 0; n < names.length; n++) {
      const name = names[n]!;
      const arity = table[name];
      const attached = long ? equals >= 0 : n < names.length - 1;
      if (!arity || (arity === "flag" && long && attached)) {
        result.unsupported = true;
        if (policy.unknown === "abort") return result;
        continue;
      }
      result.flags.push(name);
      if (arity === "value" && !attached) {
        if (!words[++i]) result.unsupported = true;
      }
      if (arity !== "flag") break;
    }
  }
  return result;
}

export function optionTable(flags: string, values = "", optional = ""): OptionTable {
  return Object.fromEntries([
    ...flags
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => [name, "flag"]),
    ...values
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => [name, "value"]),
    ...optional
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => [name, "optional"]),
  ]);
}

export function enabled(flags: string[], yes: string[], no: string[] = []): boolean {
  let result = false;
  for (const flag of flags) {
    if (yes.includes(flag)) result = true;
    if (no.includes(flag)) result = false;
  }
  return result;
}

export function settleRule(
  rule: string | false,
  parsed: Pick<ParsedOptions, "unsupported">,
): string | false | undefined {
  return rule || (parsed.unsupported ? undefined : false);
}
