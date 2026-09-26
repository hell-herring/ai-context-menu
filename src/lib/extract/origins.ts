// フレームの実際のオリジンの取得（除外ドメインの判定用）。注入スクリプト（entrypoints/extract-origins.ts）から呼ぶ。
// `about:blank` / `about:srcdoc` 等のフレームは URL にホスト名がなく、親フレームのオリジンを引き継ぐため、
// URL だけでは除外サイトの中のフレームを判定できない。ページの内容は読まない（オリジンのみを返す）。

/** 返す祖先オリジンの上限（通常はフレームの入れ子の深さ程度） */
export const MAX_ANCESTOR_ORIGINS = 32;

/** 文書の実際のオリジンと、祖先フレームのオリジン（Chrome の `location.ancestorOrigins`） */
export function collectOrigins(
  win: Pick<Window, "origin"> & { location: Pick<Location, "ancestorOrigins"> },
): string[] {
  const ancestors = win.location.ancestorOrigins
    ? Array.from(win.location.ancestorOrigins).slice(0, MAX_ANCESTOR_ORIGINS)
    : [];
  return [win.origin, ...ancestors];
}
