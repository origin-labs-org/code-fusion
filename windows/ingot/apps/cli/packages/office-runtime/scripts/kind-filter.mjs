
export function keepKindLines(source, kinds) {
  return source
    .split(/\r?\n/)
    .filter((line) => {
      const kind = / \/\/ kind:(\w+)$/.exec(line)?.[1];
      return !kind || kinds.includes(kind);
    })
    .join("\n");
}
