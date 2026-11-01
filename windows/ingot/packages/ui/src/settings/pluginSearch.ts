import { pinyin } from "pinyin-pro";

const namePinyin = new Map<string, readonly string[]>();

function pinyinKeys(name: string): readonly string[] {
  const cached = namePinyin.get(name);
  if (cached) return cached;
  const syllables = pinyin(name, { toneType: "none", type: "array" });
  const keys = [syllables.join(""), syllables.map((part) => part[0] ?? "").join("")].map((key) =>
    key.toLowerCase().replace(/\s+/g, ""),
  );
  if (namePinyin.size >= 1000) namePinyin.clear();
  namePinyin.set(name, keys);
  return keys;
}

export function pluginSearchMatches(
  query: string,
  text: readonly (string | undefined)[],
  names: readonly (string | undefined)[],
): boolean {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  if ([...text, ...names].some((value) => value?.toLowerCase().includes(keyword))) return true;
  const pinyinQuery = keyword.replace(/\s+/g, "");
  if (!/^[a-z]+$/.test(pinyinQuery)) return false;
  return names.some(
    (name) =>
      name &&
      /\p{Script=Han}/u.test(name) &&
      pinyinKeys(name).some((key) => key.includes(pinyinQuery)),
  );
}
