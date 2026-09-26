import { describe, expect, it } from "vitest";
import {
  escapedTextLength,
  escapeXmlAttribute,
  escapeXmlText,
  truncateToEscapedLength,
} from "./escape";

describe("escapeXmlText", () => {
  it("& < > を実体参照に置換する（引用符はそのまま）", () => {
    expect(escapeXmlText(`a & b <c> "d" 'e'`)).toBe(`a &amp; b &lt;c&gt; "d" 'e'`);
  });

  it("閉じタグを本文に含めても区切りを抜けられない", () => {
    expect(escapeXmlText("</document>")).toBe("&lt;/document&gt;");
  });
});

describe("escapeXmlAttribute", () => {
  it("& < > \" ' を実体参照に置換する", () => {
    expect(escapeXmlAttribute(`"></document><x a='1'>&`)).toBe(
      "&quot;&gt;&lt;/document&gt;&lt;x a=&apos;1&apos;&gt;&amp;",
    );
  });
});

describe("escapedTextLength", () => {
  it.each(["", "plain", "a & b <c>", "日本語 & 絵文字 😀", "&&&<<<>>>"])(
    "escapeXmlText(%j).length と一致する",
    (value) => {
      expect(escapedTextLength(value)).toBe(escapeXmlText(value).length);
    },
  );
});

describe("truncateToEscapedLength", () => {
  it("上限以下ならそのまま返す", () => {
    expect(truncateToEscapedLength("abc", 3)).toBe("abc");
  });

  it("エスケープ後の長さが上限に収まる位置で切る", () => {
    // "a&b" はエスケープ後 "a&amp;b"（7 文字）
    expect(truncateToEscapedLength("a&b", 6)).toBe("a&");
    expect(truncateToEscapedLength("a&b", 5)).toBe("a");
    expect(escapedTextLength(truncateToEscapedLength("<<<<<", 10))).toBeLessThanOrEqual(10);
  });

  it("サロゲートペアの途中で切らない", () => {
    expect(truncateToEscapedLength("a😀b", 2)).toBe("a");
    expect(truncateToEscapedLength("a😀b", 3)).toBe("a😀");
  });
});
