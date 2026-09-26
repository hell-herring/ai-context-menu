import OpenAI from "openai";
import type {
  ResponseCreateParamsStreaming,
  Response as ResponseObject,
} from "openai/resources/responses/responses";
import type { ReasoningEffort } from "openai/resources/shared";
import {
  type ModelInfo,
  type Provider,
  ProviderError,
  type StopReason,
  type StreamEvent,
} from "./types";

/** 送信先は公式ホストに固定する（ユーザー設定・環境変数で変更させない。docs/guardrails.md §1） */
const OPENAI_BASE_URL = "https://api.openai.com/v1";

interface ModelOptions {
  /** 要約用途のため推論は控えめにする（推論トークンも max_output_tokens に含まれるため） */
  reasoningEffort?: ReasoningEffort;
}

/**
 * モデル依存パラメータの許可リスト（docs/tech-stack.md §4.4・§4.5）。
 * ここにないモデルには付与しない（未対応パラメータによる 400 を避ける）。
 */
const MODEL_OPTIONS: Record<string, ModelOptions> = {
  "gpt-6-sol": { reasoningEffort: "low" },
  "gpt-6-luna": { reasoningEffort: "low" },
};

/**
 * テキスト生成（要約）に使えるモデルの許可パターン（docs/spec.md §3.6）。
 * Models API は埋め込み・画像・音声・モデレーション等も返すため、一覧はこのパターンで絞る。
 */
const TEXT_MODEL_PATTERN = /^(gpt-\d+(\.\d+)?o?|o\d+)(-[a-z]+)*(-\d{4}-\d{2}-\d{2})?$/;

/**
 * 許可パターンに一致しても要約に使わないもの（音声・画像・検索・コーディング専用・pro 等）。
 * `preview` は一律に除かない（`o1-preview` 等のテキストモデルがあるため。音声・検索等の preview は種別の語で除く）
 */
const NON_TEXT_MODEL_PATTERN =
  /(audio|realtime|image|transcribe|tts|search|embedding|moderation|instruct|codex|computer|research|-pro)(-|$)/;

/**
 * モデルの上限の既知値（docs/spec.md §3.3・§3.6）。OpenAI の Models API は上限を返さないため、
 * 公式ドキュメントで確認できたものだけをここに載せる（推測で書かない）。載っていないモデルは上限不明として扱う。
 */
const KNOWN_MODEL_LIMITS: Record<string, Omit<ModelInfo, "id">> = {};

export function isTextGenerationModel(id: string): boolean {
  return TEXT_MODEL_PATTERN.test(id) && !NON_TEXT_MODEL_PATTERN.test(id);
}

export interface OpenAIProviderOptions {
  /** テスト用。本番では指定しない（グローバルの fetch を使う） */
  fetch?: typeof fetch;
}

export function createOpenAIProvider(options: OpenAIProviderOptions = {}): Provider {
  const createClient = (apiKey: string) =>
    new OpenAI({
      apiKey,
      // 環境変数などから組織・プロジェクト・送信先を読み込ませない
      adminAPIKey: null,
      organization: null,
      project: null,
      webhookSecret: null,
      baseURL: OPENAI_BASE_URL,
      // BYOK: ユーザー自身のキーを自分のブラウザで使うため許容する（docs/guardrails.md §1）
      dangerouslyAllowBrowser: true,
      // リクエスト内容をログに出さない
      logLevel: "off",
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });

  return {
    id: "openai",
    displayName: "OpenAI",

    async listModels(apiKey) {
      try {
        const ids: string[] = [];
        for await (const model of createClient(apiKey).models.list()) {
          if (isTextGenerationModel(model.id)) {
            ids.push(model.id);
          }
        }
        return ids.sort().map((id) => ({
          id,
          maxInputTokens: KNOWN_MODEL_LIMITS[id]?.maxInputTokens,
          maxOutputTokens: KNOWN_MODEL_LIMITS[id]?.maxOutputTokens,
        }));
      } catch (error) {
        throw toProviderError(error);
      }
    },

    async verifyKey(apiKey) {
      try {
        // 一覧の 1 ページ目だけを取得する（キーの検証のみ）
        await createClient(apiKey).models.list();
      } catch (error) {
        throw toProviderError(error);
      }
    },

    async *stream(apiKey, req): AsyncGenerator<StreamEvent> {
      const params: ResponseCreateParamsStreaming = {
        model: req.model,
        instructions: req.system,
        input: req.userContent,
        max_output_tokens: req.maxOutputTokens,
        // 既定ではレスポンスが OpenAI 側に 30 日以上保存されるため、保存させない（docs/guardrails.md §2）
        store: false,
        stream: true,
      };
      const reasoningEffort = MODEL_OPTIONS[req.model]?.reasoningEffort;
      if (reasoningEffort) {
        params.reasoning = { effort: reasoningEffort };
      }

      try {
        const stream = await createClient(apiKey).responses.create(params, {
          signal: req.signal,
        });
        let refused = false;
        for await (const event of stream) {
          // 停止後に受信済みのイベントを表示しない
          if (req.signal.aborted) {
            throw new ProviderError("aborted");
          }
          switch (event.type) {
            case "response.output_text.delta":
              yield { type: "text", text: event.delta };
              break;
            case "response.refusal.delta":
              refused = true;
              break;
            case "response.completed":
            case "response.incomplete":
              yield {
                type: "done",
                stopReason: refused ? "refusal" : toStopReason(event.response),
                ...usageOf(event.response),
              };
              return;
            case "response.failed":
              throw responseFailedError(event.response);
          }
        }
        // 終了イベントを受け取る前にストリームが閉じた（停止した場合は中断として扱う）
        throw new ProviderError(req.signal.aborted ? "aborted" : "network");
      } catch (error) {
        throw toProviderError(error, req.signal);
      }
    },
  };
}

function toStopReason(response: ResponseObject): StopReason {
  switch (response.incomplete_details?.reason) {
    case "max_output_tokens":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "end";
  }
}

function usageOf(response: ResponseObject): Pick<Extract<StreamEvent, { type: "done" }>, "usage"> {
  const usage = response.usage;
  return usage
    ? { usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } }
    : {};
}

/** `response.failed` のエラーコードを共通エラーに変換する（メッセージ本文は保持しない） */
function responseFailedError(response: ResponseObject): ProviderError {
  switch (response.error?.code) {
    case "rate_limit_exceeded":
      return new ProviderError("rate_limit");
    case "server_error":
    case undefined:
      return new ProviderError("overloaded");
    default:
      return new ProviderError("bad_request");
  }
}

/** SDK の型付き例外クラスで分岐して共通エラーに変換する（メッセージ文字列でマッチしない） */
export function toProviderError(error: unknown, signal?: AbortSignal): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  if (error instanceof OpenAI.APIUserAbortError || signal?.aborted) {
    return new ProviderError("aborted");
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new ProviderError("network");
  }
  if (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError
  ) {
    return new ProviderError("auth", error.status);
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new ProviderError("rate_limit", error.status);
  }
  if (error instanceof OpenAI.InternalServerError) {
    return new ProviderError("overloaded", error.status);
  }
  if (error instanceof OpenAI.APIError) {
    // ストリーム途中の error イベントは status を持たない APIError として届く
    const status = typeof error.status === "number" ? error.status : undefined;
    if (status === undefined) {
      return new ProviderError(error.code === "rate_limit_exceeded" ? "rate_limit" : "overloaded");
    }
    return new ProviderError(status >= 500 ? "overloaded" : "bad_request", status);
  }
  return new ProviderError("unknown");
}
