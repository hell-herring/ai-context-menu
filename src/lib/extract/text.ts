// 注入スクリプト（ページ本文・選択テキスト）で共有する処理。
// 注入スクリプトを小さく保つため、ここでは外部の依存を import しない。

/** 注入スクリプトが返す本文のハード上限（docs/tech-stack.md §4.2 手順 5） */
export const MAX_EXTRACT_CHARS = 1_000_000;

/** テキストをハード上限で打ち切り、打ち切る前の文字数を併せて返す。サロゲートペアの途中では切らない */
export function capText(text: string): { text: string; originalLength: number } {
  if (text.length <= MAX_EXTRACT_CHARS) {
    return { text, originalLength: text.length };
  }
  let end = MAX_EXTRACT_CHARS;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    end--;
  }
  return { text: text.slice(0, end), originalLength: text.length };
}
