import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  DEFAULT_SETTINGS,
  getCoreSettings,
  getExcludedDomains,
  setExcludedDomains,
  updateCoreSettings,
  watchCoreSettings,
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

  it("M1 で保存された値（OpenAI のモデル・上限・送信前確認なし）は既定値で補う", async () => {
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
      modelLimits: {},
      confirmBeforeSend: "oversize",
    });
  });

  it.each([
    { ...DEFAULT_SETTINGS, defaultProvider: "gemini" },
    { ...DEFAULT_SETTINGS, maxOutputTokens: 100_000 },
    { ...DEFAULT_SETTINGS, maxInputChars: 999 },
    { ...DEFAULT_SETTINGS, version: 2 },
    { ...DEFAULT_SETTINGS, confirmBeforeSend: "sometimes" },
    { ...DEFAULT_SETTINGS, modelLimits: { anthropic: { model: "x", maxOutputTokens: -1 } } },
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

  it("モデルの上限と送信前確認を保存する", async () => {
    const modelLimits = { anthropic: { model: "claude-opus-5", maxOutputTokens: 128_000 } };
    await updateCoreSettings({ modelLimits, confirmBeforeSend: "always" });
    expect(await getCoreSettings()).toMatchObject({ modelLimits, confirmBeforeSend: "always" });
  });

  it("関数を渡すと最新の値から更新内容を決め、続けて呼んでも更新を失わない", async () => {
    const saves = [
      updateCoreSettings((current) => ({ models: { ...current.models, anthropic: "a" } })),
      updateCoreSettings((current) => ({ models: { ...current.models, openai: "b" } })),
    ];
    const [, last] = await Promise.all(saves);
    expect(last?.models).toEqual({ anthropic: "a", openai: "b" });
    expect((await getCoreSettings()).models).toEqual({ anthropic: "a", openai: "b" });
  });

  it("関数が例外を投げたら保存せず、後続の更新は続ける", async () => {
    await expect(
      updateCoreSettings(() => {
        throw new Error("rejected");
      }),
    ).rejects.toThrow("rejected");
    await updateCoreSettings({ maxInputChars: 10_000 });
    expect(await getCoreSettings()).toEqual({ ...DEFAULT_SETTINGS, maxInputChars: 10_000 });
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

describe("watchCoreSettings", () => {
  it("settings.core の変更だけを通知し、解除後は通知しない", async () => {
    const onChange = vi.fn();
    const unwatch = watchCoreSettings(onChange);

    await setExcludedDomains(["example.com"]);
    expect(onChange).not.toHaveBeenCalled();
    await updateCoreSettings({ maxOutputTokens: 1_000 });
    expect(onChange).toHaveBeenCalledOnce();

    unwatch();
    await updateCoreSettings({ maxOutputTokens: 2_000 });
    expect(onChange).toHaveBeenCalledOnce();
  });
});
