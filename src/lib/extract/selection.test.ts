// @vitest-environment-options { "url": "https://example.com/news/1?session=abc#top" }
import { beforeEach, describe, expect, it } from "vitest";
import { SelectionExtractionSchema } from "./schema";
import { extractSelection } from "./selection";
import { MAX_EXTRACT_CHARS } from "./text";

function select(node: Node): void {
  const selection = document.getSelection();
  if (!selection) {
    throw new Error("Selection is not available");
  }
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.addRange(range);
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`#${id} not found`);
  }
  return found;
}

beforeEach(() => {
  document.title = " 選択テストのページ ";
  document.body.innerHTML = `
    <article id="article"><p id="first">最初の段落。</p><p id="second">二番目の段落。</p></article>
    <input id="input" value="INPUT_VALUE">
    <textarea id="textarea">TEXTAREA_VALUE</textarea>
    <div id="editable" contenteditable="true"><p id="draft">EDITABLE_DRAFT</p></div>
    <div id="readonly" contenteditable="false">READONLY_TEXT</div>
  `;
  document.getSelection()?.removeAllRanges();
  (document.activeElement as HTMLElement | null)?.blur();
});

describe("extractSelection", () => {
  it("選択テキストとページのタイトル・URL を返す", () => {
    select(element("first"));
    const result = extractSelection(document);

    expect(SelectionExtractionSchema.parse(result)).toEqual(result);
    expect(result).toEqual({
      title: "選択テストのページ",
      url: "https://example.com/news/1?session=abc#top",
      text: "最初の段落。",
      originalLength: "最初の段落。".length,
      editable: false,
    });
  });

  it("選択がなければ空文字を返す", () => {
    expect(extractSelection(document)).toMatchObject({ text: "", editable: false });
  });

  it("contenteditable=false の要素の選択は通常どおり返す", () => {
    select(element("readonly"));
    expect(extractSelection(document)).toMatchObject({ text: "READONLY_TEXT", editable: false });
  });

  it("フォーカスがフォーム部品にあればテキストを返さない", () => {
    select(element("first"));
    element("input").focus();
    expect(extractSelection(document)).toMatchObject({ text: "", editable: true });
  });

  it("編集可能要素内の選択はテキストを返さない", () => {
    select(element("draft"));
    expect(extractSelection(document)).toMatchObject({ text: "", editable: true });
  });

  it("選択範囲が編集可能要素にかかっていればテキストを返さない", () => {
    select(document.body);
    const result = extractSelection(document);
    expect(result).toMatchObject({ text: "", editable: true });
    expect(JSON.stringify(result)).not.toContain("EDITABLE_DRAFT");
  });

  it("テキストエリア内の選択はテキストを返さない", () => {
    select(element("textarea"));
    expect(extractSelection(document)).toMatchObject({ text: "", editable: true });
  });

  it("選択テキストをハード上限で打ち切り、元の文字数を返す", () => {
    element("first").textContent = "あ".repeat(MAX_EXTRACT_CHARS + 10);
    select(element("first"));
    const result = extractSelection(document);
    expect(result.text.length).toBeLessThanOrEqual(MAX_EXTRACT_CHARS);
    expect(result.originalLength).toBe(MAX_EXTRACT_CHARS + 10);
  });

  it("ページの DOM を変更しない", () => {
    select(element("article"));
    const before = document.documentElement.outerHTML;
    extractSelection(document);
    expect(document.documentElement.outerHTML).toBe(before);
  });
});
