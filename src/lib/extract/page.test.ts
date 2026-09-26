// @vitest-environment-options { "url": "https://example.com/news/1?session=abc#top" }
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readability } from "@mozilla/readability";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractPage, nodeToText } from "./page";
import { PageExtractionSchema } from "./schema";
import { MAX_EXTRACT_CHARS } from "./text";

const FIXTURES = path.resolve(import.meta.dirname, "../../../tests/fixtures");

function loadFixture(name: string): void {
  const html = readFileSync(path.join(FIXTURES, name), "utf8");
  document.open();
  document.write(html);
  document.close();
}

const HIDDEN_MARKERS = [
  "INLINE_HIDDEN",
  "CLASS_HIDDEN",
  "ATTR_HIDDEN",
  "VISIBILITY_HIDDEN",
  "CONTENT_VISIBILITY_HIDDEN",
];
const FORM_MARKERS = ["INPUT_VALUE", "TEXTAREA_VALUE", "OPTION_VALUE", "EDITABLE_DRAFT"];

describe("extractPage", () => {
  beforeEach(() => {
    loadFixture("article.html");
  });

  it("Readability で本文を抽出し、段落の区切りを改行として残す", () => {
    const result = extractPage(document);

    expect(PageExtractionSchema.parse(result)).toEqual(result);
    expect(result.method).toBe("readability");
    expect(result.title).toContain("テスト記事");
    expect(result.url).toBe("https://example.com/news/1?session=abc#top");
    expect(result.text).toContain("最初の段落です。");
    expect(result.text).toMatch(/繰り返しています。\n+二番目の段落です。/);
    expect(result.text).toContain("NOT_EDITABLE_TEXT");
    expect(result.originalLength).toBe(result.text.length);
  });

  it("非表示要素・フォーム部品・編集可能要素・スクリプトを含めない", () => {
    const { text } = extractPage(document);
    for (const marker of [...HIDDEN_MARKERS, ...FORM_MARKERS, "SCRIPT_CONTENT"]) {
      expect(text, marker).not.toContain(marker);
    }
  });

  it("ページの DOM を変更しない", () => {
    const before = document.documentElement.outerHTML;
    extractPage(document);
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("Readability が本文を見つけられなければ、同じ除去済みクローンのテキストにフォールバックする", () => {
    vi.spyOn(Readability.prototype, "parse").mockReturnValue(null);
    const result = extractPage(document);

    expect(result.method).toBe("text");
    expect(result.text).toContain("最初の段落です。");
    expect(result.text).toContain("© Example News");
    for (const marker of [...HIDDEN_MARKERS, ...FORM_MARKERS, "SCRIPT_CONTENT"]) {
      expect(result.text, marker).not.toContain(marker);
    }
  });

  it("Readability が例外を投げてもフォールバックする", () => {
    vi.spyOn(Readability.prototype, "parse").mockImplementation(() => {
      throw new Error("parse failed");
    });
    expect(extractPage(document).method).toBe("text");
  });

  it("本文をハード上限で打ち切り、元の文字数を返す", () => {
    document.body.innerHTML = `<p>${"あ".repeat(MAX_EXTRACT_CHARS + 10)}</p>`;
    const result = extractPage(document);
    expect(result.text.length).toBeLessThanOrEqual(MAX_EXTRACT_CHARS);
    expect(result.originalLength).toBe(MAX_EXTRACT_CHARS + 10);
  });
});

describe("nodeToText", () => {
  it("ブロック要素を改行、空白の連続を 1 つにまとめる", () => {
    const div = document.createElement("div");
    div.innerHTML = "<h2>見出し</h2><p>a   b\n c</p><ul><li>1</li><li>2</li></ul>行<br>分け";
    expect(nodeToText(div)).toBe("見出し\n\na b c\n\n1\n\n2\n\n行\n分け");
  });

  it("表のセルを空白で区切る", () => {
    const table = document.createElement("table");
    table.innerHTML = "<tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr>";
    expect(nodeToText(table)).toBe("a b\n\nc d");
  });
});
