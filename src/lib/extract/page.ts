import { Readability } from "@mozilla/readability";
import { capText } from "./text";

// ページ本文の抽出（docs/spec.md §3.2）。注入スクリプト（entrypoints/extract.ts）から呼ぶ。
// ページ DOM は変更しない（読み取りのみ）。処理はすべて document.cloneNode(true) に対して行う。
// 注入スクリプトを小さく保つため、zod 等の拡張側の依存はここで import しない（検証は ./schema.ts）。

export interface PageExtraction {
  title: string;
  url: string;
  text: string;
  method: "readability" | "text";
  /** 打ち切る前の本文の文字数 */
  originalLength: number;
}

/** 値を持つフォーム部品と編集可能要素（下書き等を送らないため除去する。`form` 要素自体は残す） */
const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "option",
  '[contenteditable]:not([contenteditable="false" i])',
].join(",");

/** 本文ではない要素 */
const NON_CONTENT_SELECTOR = "script,style,noscript,template";

export function extractPage(doc: Document): PageExtraction {
  const clone = doc.cloneNode(true) as Document;
  removeHiddenElements(doc, clone);
  for (const element of clone.querySelectorAll(`${EDITABLE_SELECTOR},${NON_CONTENT_SELECTOR}`)) {
    element.remove();
  }

  // Readability は渡した文書を変更するため、フォールバック用に除去済みクローンを残しておく
  const article = parseArticle(clone.cloneNode(true) as Document);
  const articleText = article ? nodeToText(article.content) : "";

  const [text, method] =
    articleText.trim() !== ""
      ? [articleText, "readability" as const]
      : [clone.body ? nodeToText(clone.body) : "", "text" as const];

  return {
    title: (article?.title?.trim() || doc.title).trim(),
    url: doc.URL,
    ...capText(text),
    method,
  };
}

function parseArticle(doc: Document): { title: string | null | undefined; content: Node } | null {
  try {
    const article = new Readability<Node>(doc, { serializer: (node) => node }).parse();
    return article?.content ? { title: article.title, content: article.content } : null;
  } catch {
    return null;
  }
}

/**
 * 非表示要素をクローンから削除する。クローンでは計算済みスタイルが失われるため、
 * ライブ DOM を読み取り専用で走査して非表示の要素を特定し、同じ位置にあるクローンの要素を削除する。
 */
function removeHiddenElements(live: Document, clone: Document): void {
  const view = live.defaultView;
  const liveElements = live.querySelectorAll("*");
  const cloneElements = clone.querySelectorAll("*");
  if (!view || liveElements.length !== cloneElements.length) {
    // 対応が取れない場合は非表示要素を送ってしまわないよう中止する
    throw new Error("Failed to map the document clone");
  }

  const hidden = new Set<Element>();
  const toRemove: Element[] = [];
  liveElements.forEach((element, index) => {
    const parent = element.parentElement;
    if (parent && hidden.has(parent)) {
      // 祖先ごと削除されるので計算不要
      hidden.add(element);
      return;
    }
    if (isHidden(element, view)) {
      hidden.add(element);
      const target = cloneElements[index];
      if (target) {
        toRemove.push(target);
      }
    }
  });
  for (const element of toRemove) {
    element.remove();
  }
}

function isHidden(element: Element, view: Window): boolean {
  if (element.hasAttribute("hidden")) {
    return true;
  }
  const style = view.getComputedStyle(element);
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    style.getPropertyValue("content-visibility") === "hidden"
  );
}

const BLOCK_ELEMENTS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "CAPTION",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TR",
  "UL",
]);

const CELL_ELEMENTS = new Set(["TD", "TH"]);

/** 要素のテキストを、ブロック要素の区切りを改行として保ちながら取り出す */
export function nodeToText(root: Node): string {
  const parts: string[] = [];
  collectText(root, parts, false);
  return parts
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectText(node: Node, parts: string[], preformatted: boolean): void {
  if (node.nodeType === node.TEXT_NODE) {
    const data = node.nodeValue ?? "";
    parts.push(preformatted ? data : data.replace(/\s+/g, " "));
    return;
  }
  if (node.nodeType !== node.ELEMENT_NODE && node.nodeType !== node.DOCUMENT_FRAGMENT_NODE) {
    return;
  }
  const tag = node.nodeType === node.ELEMENT_NODE ? (node as Element).tagName.toUpperCase() : "";
  if (tag === "BR") {
    parts.push("\n");
    return;
  }
  const block = BLOCK_ELEMENTS.has(tag);
  if (block) {
    parts.push("\n");
  }
  const childPreformatted = preformatted || tag === "PRE";
  for (const child of node.childNodes) {
    collectText(child, parts, childPreformatted);
  }
  if (block) {
    parts.push("\n");
  } else if (CELL_ELEMENTS.has(tag)) {
    parts.push(" ");
  }
}
