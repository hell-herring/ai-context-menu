import { buildPrompt, describeOutputLanguage, type Prompt } from "../prompt/build";
import { estimatePromptTokens, inputTokenBudget, truncateEscapedToTokens } from "../prompt/fit";
import { currentModelLimits, effectiveMaxOutputTokens } from "../providers/limits";
import type { ProviderId } from "../providers/types";
import type { ContentJob, CoreSettings } from "../storage/schema";

/** 選択中のモデルの入力上限に収まらない場合の内訳（確認画面に表示する） */
export interface ModelOverflow {
  provider: ProviderId;
  model: string;
  /** プロンプト全体の推定トークン数 */
  estimatedTokens: number;
  /** 入力に使えるトークン数（モデルの入力上限 − 最大出力トークン） */
  budget: number;
}

/**
 * ユーザーが「モデルに収まる長さまで送信」を選んだときに表示していた条件。
 * 送信時のプロバイダ・モデル・使える量がこれと一致する場合だけ、確認なしで切り詰める
 */
export type ModelFitApproval = Pick<ModelOverflow, "provider" | "model" | "budget">;

export function approvalOf(overflow: ModelOverflow): ModelFitApproval {
  return { provider: overflow.provider, model: overflow.model, budget: overflow.budget };
}

export type RequestPlan =
  | {
      kind: "ready";
      prompt: Prompt;
      maxOutputTokens: number;
      /** モデルに収めるために本文を切り詰めた場合、送る本文の文字数 */
      fittedChars: number | undefined;
    }
  /** モデルに収まらない（ユーザーの確認が必要） */
  | { kind: "overflow"; overflow: ModelOverflow }
  /** 本文を空にしても収まらない（送信できない） */
  | { kind: "tooLong"; overflow: ModelOverflow };

/**
 * プロバイダに送るプロンプトを組み立て、選択中のモデルのコンテキスト長で判定する（docs/spec.md §3.3）。
 * モデルの入力上限が分からなければ判定しない。
 * `approval` はユーザーが「モデルに収まる長さまで送信」を選んだときの条件。条件が変わっていれば
 * （確認後にモデルや最大出力トークンを変えた等）切り詰めずに、新しい内訳で確認に戻す。
 */
export function planRequest(
  job: ContentJob,
  settings: CoreSettings,
  provider: ProviderId,
  uiLanguage: string,
  approval: ModelFitApproval | undefined,
): RequestPlan {
  const build = (content: string) =>
    buildPrompt({
      presetId: job.presetId,
      outputLanguage: describeOutputLanguage(settings.outputLanguage, uiLanguage),
      document: {
        title: job.source.title,
        url: job.source.providerUrl,
        source: job.source.type,
        content,
      },
    });
  const maxOutputTokens = effectiveMaxOutputTokens(settings, provider);
  const prompt = build(job.source.text);
  const maxInputTokens = currentModelLimits(settings, provider)?.maxInputTokens;
  if (maxInputTokens === undefined) {
    return { kind: "ready", prompt, maxOutputTokens, fittedChars: undefined };
  }

  const budget = inputTokenBudget(maxInputTokens, maxOutputTokens);
  const estimatedTokens = estimatePromptTokens(prompt);
  if (estimatedTokens <= budget) {
    return { kind: "ready", prompt, maxOutputTokens, fittedChars: undefined };
  }
  const overflow = { provider, model: settings.models[provider], estimatedTokens, budget };
  // 本文以外（system・メタデータ・指示）の分。本文を足した概算はこれと本文の概算の和以下になる
  const overhead = estimatePromptTokens(build(""));
  if (overhead >= budget) {
    return { kind: "tooLong", overflow };
  }
  const approved =
    approval !== undefined &&
    approval.provider === provider &&
    approval.model === overflow.model &&
    approval.budget === budget;
  if (!approved) {
    return { kind: "overflow", overflow };
  }
  const fitted = truncateEscapedToTokens(job.source.text, budget - overhead);
  if (fitted.trim() === "") {
    return { kind: "tooLong", overflow };
  }
  return { kind: "ready", prompt: build(fitted), maxOutputTokens, fittedChars: fitted.length };
}
