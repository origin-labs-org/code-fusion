
export function reconcileProjectOrder(
  saved: readonly string[],
  current: readonly string[],
  upgradeKeys?: ReadonlyMap<string, string>,
): string[] {
  const retained = upgradeKeys?.size
    ? saved.map((key) => {
        try {
          const identity: unknown = JSON.parse(key);
          return Array.isArray(identity) ? (upgradeKeys.get(identity[1]) ?? key) : key;
        } catch {
          return key;
        }
      })
    : saved;
  return [...new Set([...retained, ...current])];
}
export function moveProjectOrder(
  saved: readonly string[],
  section: readonly string[],
  active: string,
  over: string,
): string[] {
  const from = section.indexOf(active),
    to = section.indexOf(over);
  if (from < 0 || to < 0 || from === to) return [...saved];
  const moved = [...section];
  moved.splice(to, 0, moved.splice(from, 1)[0]!);
  const members = new Set(section);
  let index = 0;
  return reconcileProjectOrder(saved, section).map((key) =>
    members.has(key) ? moved[index++]! : key,
  );
}
