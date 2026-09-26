import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { DEFAULT_SETTINGS, getCoreSettings } from "./settings";

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

  it.each([
    { ...DEFAULT_SETTINGS, maxOutputTokens: 100_000 },
    { ...DEFAULT_SETTINGS, maxInputChars: 999 },
    { ...DEFAULT_SETTINGS, version: 2 },
    "broken",
  ])("範囲外・不正な値 %j は既定値にする", async (value) => {
    await browser.storage.sync.set({ "settings.core": value });
    expect(await getCoreSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
