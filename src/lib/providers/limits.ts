import type { CoreSettings, ModelLimits } from "../storage/schema";
import { type ModelInfo, PROVIDER_IDS, type ProviderId } from "./types";

// モデルの上限と設定の突き合わせ（docs/spec.md §3.6 最大出力トークン）

/** モデル一覧から、保存するモデルの上限を取り出す。一覧にない・上限が不明なら undefined */
export function modelLimitsFrom(
  model: string,
  models: readonly ModelInfo[],
): ModelLimits | undefined {
  const info = models.find((candidate) => candidate.id === model);
  if (!info || (info.maxInputTokens === undefined && info.maxOutputTokens === undefined)) {
    return undefined;
  }
  return {
    model,
    ...(info.maxInputTokens === undefined ? {} : { maxInputTokens: info.maxInputTokens }),
    ...(info.maxOutputTokens === undefined ? {} : { maxOutputTokens: info.maxOutputTokens }),
  };
}

/** 現在のモデル設定に対応する上限（記録したモデルが現在のモデルと違えば使わない） */
export function currentModelLimits(
  settings: Pick<CoreSettings, "models" | "modelLimits">,
  provider: ProviderId,
): ModelLimits | undefined {
  const limits = settings.modelLimits[provider];
  return limits?.model === settings.models[provider] ? limits : undefined;
}

/** リクエストに使う最大出力トークン（`min(設定値, モデルの上限)`） */
export function effectiveMaxOutputTokens(
  settings: Pick<CoreSettings, "models" | "modelLimits" | "maxOutputTokens">,
  provider: ProviderId,
): number {
  const limit = currentModelLimits(settings, provider)?.maxOutputTokens;
  return limit === undefined ? settings.maxOutputTokens : Math.min(settings.maxOutputTokens, limit);
}

/**
 * 最大出力トークンの設定値が、上限の分かっているモデルの出力上限を超えるか。
 * 超えるモデルのうち上限が最も小さいものを返す（保存時に拒否して表示する）。超えなければ undefined。
 */
export function exceededOutputLimit(
  settings: Pick<CoreSettings, "models" | "modelLimits">,
  maxOutputTokens: number,
): { provider: ProviderId; model: string; limit: number } | undefined {
  let exceeded: { provider: ProviderId; model: string; limit: number } | undefined;
  for (const provider of PROVIDER_IDS) {
    const limit = currentModelLimits(settings, provider)?.maxOutputTokens;
    if (limit !== undefined && maxOutputTokens > limit && (!exceeded || limit < exceeded.limit)) {
      exceeded = { provider, model: settings.models[provider], limit };
    }
  }
  return exceeded;
}
