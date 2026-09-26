import { describe, expect, it } from "vitest";
import { defaultProviderAfterSave, resolveProvider } from "./select";

const none = { anthropic: false, openai: false };
const both = { anthropic: true, openai: true };

describe("resolveProvider", () => {
  it.each([
    [undefined, none, undefined],
    [undefined, { anthropic: false, openai: true }, "openai"],
    [undefined, both, "anthropic"],
    ["openai", both, "openai"],
    ["openai", { anthropic: true, openai: false }, "anthropic"],
    ["anthropic", none, undefined],
  ] as const)("設定 %s・キー %o → %s", (preferred, keys, expected) => {
    expect(resolveProvider(preferred, keys)).toBe(expected);
  });
});

describe("defaultProviderAfterSave", () => {
  it("最初に登録したキーのプロバイダを既定にする", () => {
    expect(defaultProviderAfterSave(undefined, "openai", none)).toBe("openai");
  });

  it("既定のプロバイダにキーがあれば変えない", () => {
    expect(
      defaultProviderAfterSave("anthropic", "openai", { anthropic: true, openai: false }),
    ).toBeUndefined();
    expect(defaultProviderAfterSave("openai", "openai", both)).toBeUndefined();
  });

  it("既定が未保存でも、キーを登録済みのプロバイダがあればそれを維持して書き込む（M1 からの移行）", () => {
    expect(defaultProviderAfterSave(undefined, "openai", { anthropic: true, openai: false })).toBe(
      "anthropic",
    );
  });

  it("既定のプロバイダのキーが削除済みなら、保存したプロバイダを既定にする", () => {
    expect(defaultProviderAfterSave("anthropic", "openai", none)).toBe("openai");
  });

  it("既定のプロバイダのキーが削除済みで、他に登録済みのキーがあればそれを使う", () => {
    expect(
      defaultProviderAfterSave("anthropic", "anthropic", { anthropic: false, openai: true }),
    ).toBe("openai");
  });
});
