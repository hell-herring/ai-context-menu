const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * トークン数の保守的な概算（docs/spec.md §3.3）。
 * CJK 文字は 1 文字 1 トークン、その他は 3 文字 1 トークンとして数える。
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (CJK.test(char)) {
      cjk++;
    } else {
      other++;
    }
  }
  return cjk + Math.ceil(other / 3);
}
