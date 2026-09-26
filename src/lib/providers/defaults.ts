import type { ProviderId } from "./types";

/**
 * プロバイダごとの既定モデル（docs/spec.md §3.6・D-3）。既定モデルはここだけで管理する。
 * - Anthropic: docs/tech-stack.md §4.5
 * - OpenAI: 実装時点（2026-09）の OpenAI の案内で汎用向けとされている GPT-6 Sol
 */
export const DEFAULT_MODELS = {
  anthropic: "claude-opus-5",
  openai: "gpt-6-sol",
} as const satisfies Record<ProviderId, string>;
