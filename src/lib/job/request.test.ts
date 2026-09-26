import { describe, expect, it } from "vitest";
import { estimatePromptTokens } from "../prompt/fit";
import type { ContentJob, CoreSettings } from "../storage/schema";
import { DEFAULT_SETTINGS } from "../storage/settings";
import { planRequest } from "./request";

const job: ContentJob = {
  id: "00000000-0000-4000-8000-000000000000",
  windowId: 1,
  seq: 1,
  createdAt: 0,
  presetId: "summary",
  pageUrl: "https://news.example/a",
  hostnames: ["news.example"],
  kind: "content",
  source: {
    type: "page",
    method: "readability",
    title: "記事",
    displayUrl: "https://news.example/a?x=1",
    providerUrl: "https://news.example/a",
    hostname: "news.example",
    text: "本文".repeat(1_000),
    originalLength: 2_000,
    inputLimit: 50_000,
    oversize: false,
    oversizeReasons: [],
  },
};

function withLimits(maxInputTokens: number | undefined, maxOutputTokens = 1_000): CoreSettings {
  return {
    ...DEFAULT_SETTINGS,
    maxOutputTokens,
    modelLimits:
      maxInputTokens === undefined
        ? {}
        : { anthropic: { model: DEFAULT_SETTINGS.models.anthropic, maxInputTokens } },
  };
}

describe("planRequest", () => {
  it("モデルの入力上限が分からなければ判定せずにそのまま送る", () => {
    const plan = planRequest(job, withLimits(undefined), "anthropic", "ja", false);
    expect(plan).toMatchObject({ kind: "ready", maxOutputTokens: 1_000, fittedChars: undefined });
    expect(plan.kind === "ready" && plan.prompt.userContent).toContain(job.source.text);
  });

  it("入力上限 − 出力トークンに収まればそのまま送る", () => {
    const plan = planRequest(job, withLimits(100_000), "anthropic", "ja", false);
    expect(plan).toMatchObject({ kind: "ready", fittedChars: undefined });
  });

  it("収まらなければ確認に回し、推定トークン数と使える量を返す", () => {
    const plan = planRequest(job, withLimits(2_500), "anthropic", "ja", false);
    expect(plan).toMatchObject({
      kind: "overflow",
      overflow: { model: DEFAULT_SETTINGS.models.anthropic, budget: 1_500 },
    });
    expect(plan.kind === "overflow" && plan.overflow.estimatedTokens).toBeGreaterThan(2_000);
  });

  it("出力トークンを差し引くため、入力上限だけなら収まる長さでも超過と判定する", () => {
    // 本文 2,000 トークン＋α。入力上限 3,000 でも出力 1,500 を引くと収まらない
    expect(planRequest(job, withLimits(3_000, 1_500), "anthropic", "ja", false)).toMatchObject({
      kind: "overflow",
    });
  });

  it("確認後（fitToModel）は本文を先頭から切り詰め、プロンプト全体を使える量に収める", () => {
    const plan = planRequest(job, withLimits(2_500), "anthropic", "ja", true);
    if (plan.kind !== "ready") {
      throw new Error(`unexpected ${plan.kind}`);
    }
    expect(plan.fittedChars).toBeGreaterThan(0);
    expect(plan.fittedChars).toBeLessThan(job.source.text.length);
    expect(estimatePromptTokens(plan.prompt)).toBeLessThanOrEqual(1_500);
    expect(plan.prompt.userContent).toContain(job.source.text.slice(0, plan.fittedChars));
  });

  it("本文以外だけで使える量を超える場合は送信できない", () => {
    expect(planRequest(job, withLimits(1_050), "anthropic", "ja", true)).toMatchObject({
      kind: "tooLong",
    });
  });

  it("記録した上限のモデルが現在のモデルと違えば判定しない", () => {
    const settings = {
      ...withLimits(10),
      models: { ...DEFAULT_SETTINGS.models, anthropic: "claude-sonnet-5" },
    };
    expect(planRequest(job, settings, "anthropic", "ja", false)).toMatchObject({ kind: "ready" });
  });

  it("モデルの出力上限で頭打ちにした最大出力トークンで判定する", () => {
    const settings: CoreSettings = {
      ...DEFAULT_SETTINGS,
      maxOutputTokens: 8_000,
      modelLimits: {
        anthropic: {
          model: DEFAULT_SETTINGS.models.anthropic,
          maxInputTokens: 5_000,
          maxOutputTokens: 1_000,
        },
      },
    };
    const plan = planRequest(job, settings, "anthropic", "ja", false);
    expect(plan).toMatchObject({ kind: "ready", maxOutputTokens: 1_000 });
  });
});
