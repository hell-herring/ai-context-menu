// フレームの実際のオリジンの取得（除外ドメインの判定用）。注入スクリプト（entrypoints/extract-origins.ts）から呼ぶ。
// `about:blank` / `about:srcdoc` 等のフレームは URL にホスト名がなく、親フレームのオリジンを引き継ぐため、
// URL だけでは除外サイトの中のフレームを判定できない。ページの内容は読まない（オリジンのみを返す）。

/**
 * 受け付ける祖先オリジンの上限（通常はフレームの入れ子の深さ程度）。
 * 注入スクリプトでは切り捨てずにすべて返し、上限を超える場合は検証（extract/schema.ts）で失敗させて取得しない
 * （切り捨てた祖先に除外サイトがあると判定をすり抜けるため）。
 */
export const MAX_ANCESTOR_ORIGINS = 32;

/** 文書の実際のオリジンと、すべての祖先フレームのオリジン（Chrome の `location.ancestorOrigins`） */
export function collectOrigins(
  win: Pick<Window, "origin"> & { location: Pick<Location, "ancestorOrigins"> },
): string[] {
  const ancestors = win.location.ancestorOrigins ? Array.from(win.location.ancestorOrigins) : [];
  return [win.origin, ...ancestors];
}
