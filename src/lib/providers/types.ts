// プロバイダ抽象（docs/tech-stack.md §4.4）。UI はこのインターフェイスのみに依存し、SDK の型を UI 層へ漏らさない

/** 対応プロバイダ（Phase 2 で "gemini" を追加予定）。並び順は既定プロバイダを決めるときの優先順 */
export const PROVIDER_IDS = ["anthropic", "openai"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface SummarizeRequest {
  system: string;
  userContent: string;
  model: string;
  maxOutputTokens: number;
  signal: AbortSignal;
}

export type StopReason = "end" | "max_tokens" | "refusal";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "done"; stopReason: StopReason; usage?: Usage };

export interface Provider {
  id: ProviderId;
  displayName: string;
  listModels(apiKey: string): Promise<string[]>;
  /** 接続テスト。キーが無効なら ProviderError を投げる */
  verifyKey(apiKey: string): Promise<void>;
  stream(apiKey: string, req: SummarizeRequest): AsyncIterable<StreamEvent>;
}

/**
 * アダプタ共通のエラー種別。SDK の型付き例外クラスで分岐して変換する（メッセージ文字列でマッチしない）。
 * - auth: 401 / 403
 * - rate_limit: 429（SDK の自動リトライ後）
 * - overloaded: 5xx / 過負荷
 * - network: 接続できない・タイムアウト
 * - bad_request: その他の 4xx
 * - aborted: ユーザーが停止した
 */
export type ProviderErrorKind =
  | "auth"
  | "rate_limit"
  | "overloaded"
  | "network"
  | "bad_request"
  | "aborted"
  | "unknown";

/**
 * プロバイダ呼び出しのエラー。API キーやリクエスト本文を含めないよう、
 * メッセージは種別のみとし、元の例外（レスポンスの詳細を含みうる）は保持しない。
 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number | undefined;

  constructor(kind: ProviderErrorKind, status?: number) {
    super(`Provider request failed: ${kind}${status === undefined ? "" : ` (${status})`}`);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
  }
}
