const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** 1 トークンとして数えるその他の文字（CJK 以外）の数 */
const CHARS_PER_TOKEN = 3;

export function isCjk(char: string): boolean {
  return CJK.test(char);
}

/**
 * トークン数の保守的な概算（docs/spec.md §3.3）。
 * CJK 文字は 1 文字 1 トークン、その他は 3 文字 1 トークンとして数える（文字はコードポイント単位）。
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (isCjk(char)) {
      cjk++;
    } else {
      other++;
    }
  }
  return tokensOf(cjk, other);
}

/** CJK 文字数とその他の文字数から概算トークン数を求める */
export function tokensOf(cjk: number, other: number): number {
  return cjk + Math.ceil(other / CHARS_PER_TOKEN);
}
