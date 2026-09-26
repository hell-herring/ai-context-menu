import { capText } from "./text";

// 選択テキストの取得（docs/spec.md §3.2）。注入スクリプト（entrypoints/extract-selection.ts）から呼ぶ。
// ページ DOM は変更しない（読み取りのみ）。
// 注入スクリプトを小さく保つため、zod 等の拡張側の依存はここで import しない（検証は ./schema.ts）。

export interface SelectionExtraction {
  title: string;
  url: string;
  /** 選択テキスト。改行を保つため `getSelection().toString()` を使う */
  text: string;
  /** 打ち切る前の選択テキストの文字数 */
  originalLength: number;
  /** 入力欄・編集可能要素での選択。true の場合テキストは返さない（フォーム入力値を送らない） */
  editable: boolean;
}

const FORM_CONTROL_SELECTOR = "input,textarea,select,option";

const CONTENT_EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false" i])';

export function extractSelection(doc: Document): SelectionExtraction {
  const base = { title: doc.title.trim(), url: doc.URL };
  const selection = doc.getSelection();
  if (isEditableContext(doc, selection)) {
    return { ...base, text: "", originalLength: 0, editable: true };
  }
  return { ...base, ...capText(selection?.toString() ?? ""), editable: false };
}

/**
 * 入力欄・編集可能要素での選択か。`info.editable` に加えた多重の防御:
 * - フォーカスがフォーム部品・編集可能要素にある
 * - 選択の始点・終点がフォーム部品・編集可能要素の中にある
 * - 選択範囲が編集可能要素（下書き等）にかかっている
 */
function isEditableContext(doc: Document, selection: Selection | null): boolean {
  if (doc.activeElement && isInEditable(doc.activeElement)) {
    return true;
  }
  if (!selection) {
    return false;
  }
  for (const node of [selection.anchorNode, selection.focusNode]) {
    const element = node instanceof Element ? node : node?.parentElement;
    if (element && isInEditable(element)) {
      return true;
    }
  }
  const ranges = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i));
  for (const element of doc.querySelectorAll(CONTENT_EDITABLE_SELECTOR)) {
    if (ranges.some((range) => range.intersectsNode(element))) {
      return true;
    }
  }
  return false;
}

function isInEditable(element: Element): boolean {
  return (
    element.closest(`${FORM_CONTROL_SELECTOR},${CONTENT_EDITABLE_SELECTOR}`) !== null ||
    (element as Partial<HTMLElement>).isContentEditable === true
  );
}
