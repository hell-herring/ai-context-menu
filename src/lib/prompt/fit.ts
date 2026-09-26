import type { Prompt } from "./build";
import { escapeXmlText } from "./escape";
import { estimateTokens, isCjk, tokensOf } from "./tokens";

// モデルのコンテキスト長による判定（docs/spec.md §3.3）

/**
 * プロンプト全体（system＋本文＋指示）の推定トークン数。
 * system と user を別々に概算して足す（まとめて概算するより大きいか等しい＝保守的）
 */
export function estimatePromptTokens(prompt: Prompt): number {
  return estimateTokens(prompt.system) + estimateTokens(prompt.userContent);
}

/**
 * 入力に使えるトークン数。モデルの入力上限から出力トークン分を差し引く（保守的に見積もる）。
 */
export function inputTokenBudget(maxInputTokens: number, maxOutputTokens: number): number {
  return maxInputTokens - maxOutputTokens;
}

/**
 * 本文を先頭から切り詰め、XML エスケープ後の推定トークン数が `maxTokens` 以下に収まる最長の部分を返す。
 * コードポイント単位で切るため、サロゲートペアの途中では切らない。
 */
export function truncateEscapedToTokens(content: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return "";
  }
  let cjk = 0;
  let other = 0;
  let end = 0;
  for (const char of content) {
    const escaped = escapeXmlText(char);
    const nextCjk = cjk + (isCjk(char) ? 1 : 0);
    // エスケープで増えた文字（`&amp;` 等）はすべて CJK 以外
    const nextOther = other + (isCjk(char) ? 0 : [...escaped].length);
    if (tokensOf(nextCjk, nextOther) > maxTokens) {
      break;
    }
    cjk = nextCjk;
    other = nextOther;
    end += char.length;
  }
  return content.slice(0, end);
}
