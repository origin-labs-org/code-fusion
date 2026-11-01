import { describe, expect, it } from "vitest";
import zh from "@/i18n/locales/zh-CN.js";
import en from "@/i18n/locales/en-US.js";
const remoteKey =
  /^(remote\.|remoteConnection\.|sourceServer\.|settings\.source\.|settings\.remoteDevices|workspaceSidebar\.|ssh\.|wsl\.|docker\.)/u;
const forbidden =
  /链路|线路|Source Server|换代|正史|canonical|direct-tcpip|远端组件|短 ID|\bdistros?\b|docker exec|docker cp/iu;
describe("远程文案合同", () => {
  it.each([
    ["zh", zh],
    ["en", en],
  ] as const)("%s does not display engineering terminology", (_locale, messages) => {
    expect(
      Object.entries(messages).filter(
        ([key, value]) => remoteKey.test(key) && forbidden.test(value),
      ),
    ).toEqual([]);
  });
  it("New remote copy complete in both Chinese and English", () => {
    expect(
      Object.keys(zh)
        .filter((key) => remoteKey.test(key))
        .sort(),
    ).toEqual(
      Object.keys(en)
        .filter((key) => remoteKey.test(key))
        .sort(),
    );
  });
});
