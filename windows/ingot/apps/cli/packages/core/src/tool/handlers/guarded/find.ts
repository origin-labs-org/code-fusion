import type { RuleMatch } from "./git.js";
import type { CommandWord } from "./word.js";

const FLAGS = new Set(
  "-H -L -P -O0 -O1 -O2 -O3 -depth -d -x -xdev -mount -ignore_readdir_race -noignore_readdir_race -daystart -follow -noleaf -true -false -empty -readable -writable -executable -print -print0 -ls -prune -quit -a -and -o -or -not ! ( ) ,".split(
    " ",
  ),
);
const VALUES = new Set(
  "-D -f -name -iname -path -ipath -wholename -iwholename -regex -iregex -regextype -type -xtype -size -user -group -uid -gid -perm -links -inum -samefile -newer -anewer -cnewer -atime -ctime -mtime -amin -cmin -mmin -used -maxdepth -mindepth -printf -fprint -fprint0 -fls -files0-from".split(
    " ",
  ),
);
const EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

export function matchFindDelete(args: CommandWord[]): RuleMatch {
  let expression = false;
  for (let i = 0; i < args.length; i++) {
    const word = args[i]!;
    const value = word.value;
    if (!expression && !value.startsWith("-") && !["!", "("].includes(value)) continue;
    if (word.dynamic) return undefined;
    if (["-H", "-L", "-P", "-O0", "-O1", "-O2", "-O3", "-d", "-x"].includes(value) && !expression)
      continue;
    if (["-D", "-f"].includes(value) && !expression) {
      if (!args[++i]) return undefined;
      continue;
    }
    expression = true;
    if (value === "-delete") return "find-delete";
    if (EXEC.has(value)) {
      let closed = false;
      while (++i < args.length) {
        const token = args[i]!;
        if (
          !token.dynamic &&
          (token.value === ";" ||
            (token.value === "+" &&
              args[i - 1]?.value === "{}" &&
              ["-exec", "-execdir"].includes(value)))
        ) {
          closed = true;
          break;
        }
      }
      if (!closed) return undefined;
    } else if (value === "-fprintf" || VALUES.has(value) || /^-newer[acmBt][acmBt]$/.test(value)) {
      i += value === "-fprintf" ? 2 : 1;
      if (!args[i]) return undefined;
    } else if (!FLAGS.has(value)) return undefined;
  }
  return false;
}
