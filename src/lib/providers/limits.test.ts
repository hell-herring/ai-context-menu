import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../storage/settings";
import {
  currentModelLimits,
  effectiveMaxOutputTokens,
  exceededOutputLimit,
  modelLimitsFrom,
} from "./limits";

const settings = {
  ...DEFAULT_SETTINGS,
  models: { anthropic: "claude-haiku-4-5", openai: "gpt-6-sol" },
  modelLimits: {
    anthropic: { model: "claude-haiku-4-5", maxInputTokens: 200_000, maxOutputTokens: 4_096 },
  },
  maxOutputTokens: 8_000,
};

describe("modelLimitsFrom", () => {
  const models = [
    { id: "claude-opus-5", maxInputTokens: 1_000_000, maxOutputTokens: 128_000 },
    { id: "claude-legacy", maxInputTokens: undefined, maxOutputTokens: undefined },
    { id: "claude-partial", maxInputTokens: undefined, maxOutputTokens: 4_096 },
  ];

  it("一覧にあるモデルの上限を返す（不明な項目は持たない）", () => {
    expect(modelLimitsFrom("claude-opus-5", models)).toEqual({
      model: "claude-opus-5",
      maxInputTokens: 1_000_000,
      maxOutputTokens: 128_000,
    });
    expect(modelLimitsFrom("claude-partial", models)).toEqual({
      model: "claude-partial",
      maxOutputTokens: 4_096,
    });
  });

  it("一覧にない・上限が不明なら undefined", () => {
    expect(modelLimitsFrom("claude-unknown", models)).toBeUndefined();
    expect(modelLimitsFrom("claude-legacy", models)).toBeUndefined();
  });
});

describe("currentModelLimits / effectiveMaxOutputTokens", () => {
  it("記録したモデルが現在のモデルなら上限で頭打ちにする", () => {
    expect(currentModelLimits(settings, "anthropic")?.maxOutputTokens).toBe(4_096);
    expect(effectiveMaxOutputTokens(settings, "anthropic")).toBe(4_096);
  });

  it("上限の方が大きければ設定値を使う", () => {
    expect(effectiveMaxOutputTokens({ ...settings, maxOutputTokens: 2_000 }, "anthropic")).toBe(
      2_000,
    );
  });

  it("上限が分からないプロバイダは設定値を使う", () => {
    expect(effectiveMaxOutputTokens(settings, "openai")).toBe(8_000);
  });

  it("記録した後にモデルが変わっていれば古い上限を使わない", () => {
    const changed = { ...settings, models: { ...settings.models, anthropic: "claude-opus-5" } };
    expect(currentModelLimits(changed, "anthropic")).toBeUndefined();
    expect(effectiveMaxOutputTokens(changed, "anthropic")).toBe(8_000);
  });
});

describe("exceededOutputLimit", () => {
  it("上限の分かっているモデルの出力上限を超える値を検出する", () => {
    expect(exceededOutputLimit(settings, 8_000)).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      limit: 4_096,
    });
  });

  it("上限以下・上限が不明なら undefined", () => {
    expect(exceededOutputLimit(settings, 4_096)).toBeUndefined();
    expect(exceededOutputLimit(DEFAULT_SETTINGS, 32_000)).toBeUndefined();
  });

  it("複数のモデルが超える場合は上限が最も小さいものを返す", () => {
    const both = {
      ...settings,
      modelLimits: {
        ...settings.modelLimits,
        openai: { model: "gpt-6-sol", maxOutputTokens: 2_048 },
      },
    };
    expect(exceededOutputLimit(both, 8_000)).toMatchObject({ provider: "openai", limit: 2_048 });
  });
});
