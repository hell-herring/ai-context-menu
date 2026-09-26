/**
 * AI 出力内のリンクとして開いてよい URL か。http: / https: の絶対 URL のみ許可する
 * （`javascript:` / `data:` 等は無効化する。docs/guardrails.md §3.2）
 */
export function isSafeLinkUrl(url: unknown): url is string {
  if (typeof url !== "string") {
    return false;
  }
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
