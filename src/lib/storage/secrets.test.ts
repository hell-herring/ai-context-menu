import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  getApiKey,
  maskApiKey,
  normalizeApiKey,
  removeApiKey,
  setApiKey,
  watchApiKeys,
} from "./secrets";

const DUMMY_KEY = "sk-test-dummy-1234";

beforeEach(() => {
  fakeBrowser.reset();
});

describe("API キーの保存", () => {
  it("storage.local にのみ保存し、storage.sync には書かない", async () => {
    await setApiKey("anthropic", DUMMY_KEY);

    expect(await browser.storage.local.get(null)).toEqual({
      "secrets.anthropic.apiKey": DUMMY_KEY,
    });
    expect(await browser.storage.sync.get(null)).toEqual({});
    expect(await getApiKey("anthropic")).toBe(DUMMY_KEY);
  });

  it("削除できる", async () => {
    await setApiKey("anthropic", DUMMY_KEY);
    await removeApiKey("anthropic");
    expect(await getApiKey("anthropic")).toBeUndefined();
  });

  it("不正な保存値は未設定として扱う", async () => {
    await browser.storage.local.set({ "secrets.anthropic.apiKey": 123 });
    expect(await getApiKey("anthropic")).toBeUndefined();
  });
});

describe("normalizeApiKey", () => {
  it("前後の空白を除く", () => {
    expect(normalizeApiKey(`  ${DUMMY_KEY}\n`)).toBe(DUMMY_KEY);
  });

  it.each(["", "   ", "sk-test dummy"])("不正な入力 %j は undefined", (input) => {
    expect(normalizeApiKey(input)).toBeUndefined();
  });
});

describe("maskApiKey", () => {
  it("末尾 4 文字以外を表示しない", () => {
    expect(maskApiKey(DUMMY_KEY)).toBe("••••1234");
  });
});

describe("watchApiKeys", () => {
  it("キーの保存・削除だけを通知し、キーの値は渡さない", async () => {
    const onChange = vi.fn();
    const unwatch = watchApiKeys(onChange);

    await browser.storage.local.set({ other: 1 });
    expect(onChange).not.toHaveBeenCalled();
    await setApiKey("openai", DUMMY_KEY);
    await removeApiKey("openai");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls.flat()).toEqual([]);

    unwatch();
    await setApiKey("anthropic", DUMMY_KEY);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
