import { describe, expect, it } from "vitest";
import type { ContentJob } from "../storage/schema";
import { DEFAULT_SETTINGS } from "../storage/settings";
import { planRequest } from "./request";
import {
  modelChoices,
  providerChoices,
  resolveTarget,
  settingsFor,
  targetForProvider,
} from "./target";

const none = { anthropic: false, openai: false };
const both = { anthropic: true, openai: true };
const openaiOnly = { anthropic: false, openai: true };

const settings = {
  ...DEFAULT_SETTINGS,
  defaultProvider: "anthropic" as const,
  models: { anthropic: "claude-custom", openai: "gpt-6-sol" },
  modelLimits: { anthropic: { model: "claude-custom", maxInputTokens: 20_000 } },
  maxOutputTokens: 1_000,
};

describe("modelChoices", () => {
  it("保存済みのモデルと既定モデル（重複は 1 つ）", () => {
    expect(modelChoices(settings, "anthropic")).toEqual(["claude-custom", "claude-opus-5"]);
    expect(modelChoices(settings, "openai")).toEqual(["gpt-6-sol"]);
  });
});

describe("providerChoices", () => {
  it("キーのあるプロバイダ", () => {
    expect(providerChoices(both, undefined)).toEqual(["anthropic", "openai"]);
    expect(providerChoices(openaiOnly, undefined)).toEqual(["openai"]);
  });

  it("選択中のプロバイダはキーが削除されていても残す（表示が食い違わないように）", () => {
    expect(providerChoices(openaiOnly, "anthropic")).toEqual(["anthropic", "openai"]);
  });
});

describe("resolveTarget", () => {
  it("選んでいなければ設定の既定（キーがなければキーのある最初のもの）", () => {
    expect(resolveTarget(settings, both, undefined)).toEqual({
      provider: "anthropic",
      model: "claude-custom",
    });
    expect(resolveTarget(settings, openaiOnly, undefined)).toEqual({
      provider: "openai",
      model: "gpt-6-sol",
    });
    expect(resolveTarget(settings, none, undefined)).toBeUndefined();
  });

  it("選んだものを使う", () => {
    const choice = { provider: "openai", model: "gpt-6-sol" } as const;
    expect(resolveTarget(settings, both, choice)).toEqual(choice);
  });

  it("選んだプロバイダのキーが削除されていれば、他のプロバイダに切り替えずに undefined", () => {
    expect(
      resolveTarget(settings, openaiOnly, { provider: "anthropic", model: "claude-opus-5" }),
    ).toBeUndefined();
  });
});

describe("targetForProvider", () => {
  it("そのプロバイダの保存済みのモデル", () => {
    expect(targetForProvider(settings, "anthropic")).toEqual({
      provider: "anthropic",
      model: "claude-custom",
    });
  });
});

describe("settingsFor", () => {
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
      displayUrl: "https://news.example/a",
      providerUrl: "https://news.example/a",
      hostname: "news.example",
      text: "a".repeat(60_000),
      originalLength: 60_000,
      inputLimit: 500_000,
      oversize: false,
      oversizeReasons: [],
    },
  };

  it("設定は変えずに、送信先のプロバイダ・モデルを反映する", () => {
    const next = settingsFor(settings, { provider: "openai", model: "gpt-x" });
    expect(next.defaultProvider).toBe("openai");
    expect(next.models).toEqual({ anthropic: "claude-custom", openai: "gpt-x" });
    expect(settings.models.openai).toBe("gpt-6-sol");
  });

  it("保存済みのモデルなら記録した上限で判定し、他のモデルでは判定しない", () => {
    const saved = settingsFor(settings, { provider: "anthropic", model: "claude-custom" });
    expect(planRequest(job, saved, "anthropic", "ja", undefined).kind).toBe("overflow");

    const other = settingsFor(settings, { provider: "anthropic", model: "claude-opus-5" });
    expect(planRequest(job, other, "anthropic", "ja", undefined).kind).toBe("ready");
  });
});
