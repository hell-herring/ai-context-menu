import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  DEFAULT_SETTINGS,
  getCoreSettings,
  getExcludedDomains,
  setExcludedDomains,
  updateCoreSettings,
} from "./settings";
import { SyncQuotaError } from "./sync-quota";

beforeEach(() => {
  fakeBrowser.reset();
});

describe("getCoreSettings", () => {
  it("未保存なら既定値", async () => {
    expect(await getCoreSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("保存された値を返す", async () => {
    const settings = { ...DEFAULT_SETTINGS, maxInputChars: 10_000 };
    await browser.storage.sync.set({ "settings.core": settings });
    expect(await getCoreSettings()).toEqual(settings);
  });

  it("M1 で保存された値（OpenAI のモデルなし）は既定のモデルで補う", async () => {
    const m1 = {
      version: 1,
      models: { anthropic: "claude-sonnet-5" },
      outputLanguage: "ja",
      maxInputChars: 10_000,
      maxOutputTokens: 4_000,
    };
    await browser.storage.sync.set({ "settings.core": m1 });
    expect(await getCoreSettings()).toEqual({
      ...m1,
      models: { anthropic: "claude-sonnet-5", openai: DEFAULT_SETTINGS.models.openai },
    });
  });

  it.each([
    { ...DEFAULT_SETTINGS, defaultProvider: "gemini" },
    { ...DEFAULT_SETTINGS, maxOutputTokens: 100_000 },
    { ...DEFAULT_SETTINGS, maxInputChars: 999 },
    { ...DEFAULT_SETTINGS, version: 2 },
    "broken",
  ])("範囲外・不正な値 %j は既定値にする", async (value) => {
    await browser.storage.sync.set({ "settings.core": value });
    expect(await getCoreSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("updateCoreSettings", () => {
  it("一部の項目だけを更新して保存する", async () => {
    await updateCoreSettings({ defaultProvider: "openai" });
    expect(await getCoreSettings()).toEqual({ ...DEFAULT_SETTINGS, defaultProvider: "openai" });
    await updateCoreSettings({ maxInputChars: 10_000 });
    expect(await getCoreSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      defaultProvider: "openai",
      maxInputChars: 10_000,
    });
  });

  it("不正な値は保存しない", async () => {
    await expect(updateCoreSettings({ maxInputChars: 1 })).rejects.toThrow();
    expect(await browser.storage.sync.get(null)).toEqual({});
  });
});

describe("除外ドメイン", () => {
  it("未保存なら空", async () => {
    expect(await getExcludedDomains()).toEqual([]);
  });

  it("storage.sync に保存して読める", async () => {
    await setExcludedDomains(["example.com", "*.bank.example"]);
    expect(await browser.storage.sync.get("settings.excludedDomains")).toEqual({
      "settings.excludedDomains": { version: 1, domains: ["example.com", "*.bank.example"] },
    });
    expect(await getExcludedDomains()).toEqual(["example.com", "*.bank.example"]);
  });

  it("最大 200 件を超える保存は拒否する", async () => {
    const domains = Array.from({ length: 201 }, (_, i) => `d${i}.example`);
    await expect(setExcludedDomains(domains)).rejects.toThrow();
    expect(await getExcludedDomains()).toEqual([]);
  });

  it("1 項目の容量を超える保存は拒否する", async () => {
    const domains = Array.from({ length: 200 }, (_, i) => `${"a".repeat(60)}${i}.example`);
    await expect(setExcludedDomains(domains)).rejects.toMatchObject({ reason: "item" });
    await expect(setExcludedDomains(domains)).rejects.toBeInstanceOf(SyncQuotaError);
  });

  it("壊れた保存値でも解釈できるパターンは残す（除外を黙って無効にしない）", async () => {
    await browser.storage.sync.set({
      "settings.excludedDomains": { version: 99, domains: ["Bank.Example", 1, "not valid", null] },
    });
    expect(await getExcludedDomains()).toEqual(["bank.example"]);
  });

  it.each([undefined, "broken", { domains: "example.com" }])("不正な値 %j は空", async (value) => {
    await browser.storage.sync.set({ "settings.excludedDomains": value });
    expect(await getExcludedDomains()).toEqual([]);
  });
});
