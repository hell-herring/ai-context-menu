import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  type ModelInfo,
  type Provider,
  ProviderError,
  type StopReason,
  type StreamEvent,
} from "./types";

/** 送信先は公式ホストに固定する（ユーザー設定・環境変数で変更させない。docs/guardrails.md §1） */
const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

interface ModelOptions {
  effort?: "medium";
  /** 安全分類器による拒否時に、推奨モデルでサーバー側で再実行する */
  serverSideFallback?: boolean;
}

/**
 * モデル依存パラメータの許可リスト（docs/tech-stack.md §4.4・§4.5）。
 * ここにないモデルには付与しない（未対応パラメータによる 400 を避ける）。
 */
const MODEL_OPTIONS: Record<string, ModelOptions> = {
  "claude-opus-5": { effort: "medium", serverSideFallback: true },
  "claude-sonnet-5": { effort: "medium" },
};

const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface AnthropicProviderOptions {
  /** テスト用。本番では指定しない（グローバルの fetch を使う） */
  fetch?: typeof fetch;
}

export function createAnthropicProvider(options: AnthropicProviderOptions = {}): Provider {
  const createClient = (apiKey: string) =>
    new Anthropic({
      apiKey,
      authToken: null,
      baseURL: ANTHROPIC_BASE_URL,
      // BYOK: ユーザー自身のキーを自分のブラウザで使うため許容する（docs/guardrails.md §1）
      dangerouslyAllowBrowser: true,
      // リクエスト内容をログに出さない
      logLevel: "off",
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });

  return {
    id: "anthropic",
    displayName: "Anthropic",

    async listModels(apiKey) {
      try {
        const models: ModelInfo[] = [];
        for await (const model of createClient(apiKey).models.list()) {
          models.push({
            id: model.id,
            maxInputTokens: model.max_input_tokens ?? undefined,
            maxOutputTokens: model.max_tokens ?? undefined,
          });
        }
        return models;
      } catch (error) {
        throw toProviderError(error);
      }
    },

    async verifyKey(apiKey) {
      try {
        await createClient(apiKey).models.list({ limit: 1 });
      } catch (error) {
        throw toProviderError(error);
      }
    },

    async *stream(apiKey, req): AsyncGenerator<StreamEvent> {
      const params: BetaMessageStreamParams = {
        model: req.model,
        max_tokens: req.maxOutputTokens,
        system: req.system,
        messages: [{ role: "user", content: req.userContent }],
      };
      const modelOptions = MODEL_OPTIONS[req.model];
      if (modelOptions?.effort) {
        params.output_config = { effort: modelOptions.effort };
      }
      if (modelOptions?.serverSideFallback) {
        params.betas = [SERVER_SIDE_FALLBACK_BETA];
        params.fallbacks = "default";
      }

      try {
        const stream = createClient(apiKey).beta.messages.stream(params, { signal: req.signal });
        for await (const event of stream) {
          // 停止後に受信済みのイベントを表示しない
          if (req.signal.aborted) {
            throw new ProviderError("aborted");
          }
          // 拒否後にフォールバックモデルが続きを書く場合も、テキストは同じストリームに続けて届く
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { type: "text", text: event.delta.text };
          }
        }
        const message = await stream.finalMessage();
        yield {
          type: "done",
          stopReason: toStopReason(message.stop_reason),
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
          },
        };
      } catch (error) {
        throw toProviderError(error, req.signal);
      }
    },
  };
}

function toStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "end";
  }
}

/** SDK の型付き例外クラスで分岐して共通エラーに変換する（メッセージ文字列でマッチしない） */
export function toProviderError(error: unknown, signal?: AbortSignal): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  if (error instanceof Anthropic.APIUserAbortError || signal?.aborted) {
    return new ProviderError("aborted");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError("network");
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new ProviderError("auth", error.status);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError("rate_limit", error.status);
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new ProviderError("overloaded", error.status);
  }
  if (error instanceof Anthropic.APIError) {
    // ストリーム途中の overloaded_error 等は status を持たない APIError として届く
    const status = typeof error.status === "number" ? error.status : undefined;
    if (status === undefined || status >= 500) {
      return new ProviderError("overloaded", status);
    }
    return new ProviderError("bad_request", status);
  }
  return new ProviderError("unknown");
}
