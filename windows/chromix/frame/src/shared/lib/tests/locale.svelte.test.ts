import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function load(languages: string[]) {
  const root = { lang: "" };
  vi.stubGlobal("navigator", { languages, language: languages[0] });
  vi.stubGlobal("document", { documentElement: root });
  const locale = await import("../locale.svelte");
  const runtime = await import("$shared/i18n/runtime");
  return { locale, runtime, root };
}

describe("interface language", () => {
  it("follows the system to the first translated language, by region or base", async () => {
    const { locale, runtime, root } = await load(["xx-YY", "en-GB"]);
    locale.applyLanguage("system");
    expect(runtime.getLocale()).toBe("en");
    expect(root.lang).toBe("en");
  });

  it("falls back to the base language for anything untranslated", async () => {
    const { locale, runtime } = await load(["xx"]);
    locale.applyLanguage("system");
    expect(runtime.getLocale()).toBe(runtime.baseLocale);
    locale.applyLanguage("klingon");
    expect(runtime.getLocale()).toBe(runtime.baseLocale);
    locale.applyLanguage(null);
    expect(runtime.getLocale()).toBe(runtime.baseLocale);
  });

  it("offers only translated languages for the interface, English first, all of them settable", async () => {
    const { locale } = await load(["en"]);
    expect(locale.interfaceLanguages()[0]).toBe("en");
    for (const tag of locale.interfaceLanguages()) expect(locale.languages()).toContain(tag);
  });

  it("shows an untranslated language as English, left to right", async () => {
    const { locale, runtime, root } = await load(["en"]);
    locale.applyLanguage("ar");
    expect(runtime.getLocale()).toBe(runtime.baseLocale);
    expect(root).toMatchObject({ lang: "en", dir: "ltr" });
  });

  it(
    "loads a translated language on demand and shows its messages in place",
    { timeout: 30_000 },
    async () => {
      const { locale, runtime, root } = await load(["fr-CA", "en"]);
      // Exercise translation of one message without transforming the entire
      // generated message graph in this unbundled test runtime.
      const m = await import("$shared/i18n/messages/new_tab.js");
      expect(locale.interfaceLanguages()).toContain("fr");
      await locale.applyLanguage("system");
      expect(runtime.getLocale()).toBe("fr");
      expect(root.lang).toBe("fr");
      expect(m.new_tab()).toBe("Nouvel onglet");
      await locale.applyLanguage("en");
      expect(m.new_tab()).toBe("New tab");
    },
  );
});
