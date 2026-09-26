// ページ由来の値を <document> 区切りの中に安全に埋め込むための XML エスケープ（docs/tech-stack.md §4.6）

const TEXT_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

const ATTRIBUTE_ESCAPES: Record<string, string> = {
  ...TEXT_ESCAPES,
  '"': "&quot;",
  "'": "&apos;",
};

/** 要素の本文用。`& < >` を実体参照に置換する */
export function escapeXmlText(value: string): string {
  return value.replace(/[&<>]/g, (char) => TEXT_ESCAPES[char] ?? char);
}

/** 属性値用。`& < > " '` を実体参照に置換する */
export function escapeXmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ATTRIBUTE_ESCAPES[char] ?? char);
}

/** `escapeXmlText(value).length` を、文字列を生成せずに求める */
export function escapedTextLength(value: string): number {
  let length = value.length;
  for (let i = 0; i < value.length; i++) {
    length += escapeGrowth(value.charCodeAt(i));
  }
  return length;
}

/**
 * エスケープ後の長さが `maxLength` 以下に収まるよう、元テキストを先頭から切り詰める。
 * サロゲートペアの途中では切らない。
 */
export function truncateToEscapedLength(value: string, maxLength: number): string {
  let length = 0;
  let end = 0;
  while (end < value.length) {
    const code = value.charCodeAt(end);
    const isPair = code >= 0xd800 && code <= 0xdbff && end + 1 < value.length;
    const units = isPair ? 2 : 1;
    const next = length + units + escapeGrowth(code);
    if (next > maxLength) {
      break;
    }
    length = next;
    end += units;
  }
  return value.slice(0, end);
}

/** エスケープで増える文字数（`&` → `&amp;` で +4、`<` / `>` で +3） */
function escapeGrowth(code: number): number {
  switch (code) {
    case 0x26: // &
      return 4;
    case 0x3c: // <
    case 0x3e: // >
      return 3;
    default:
      return 0;
  }
}
