import { isExcludedPage, isExcludedUrl } from "../domain/exclude";
import { PageExtractionSchema, SelectionExtractionSchema } from "../extract/schema";
import type { Job } from "../storage/schema";
import {
  createContentJob,
  createErrorJob,
  createJobSource,
  type ExtractedContent,
  type JobContext,
} from "./create";

/** ページに注入する抽出スクリプト（`entrypoints/extract*.ts` のビルド出力） */
export type InjectedScript = "/extract.js" | "/extract-selection.js";

/** クリックされた場所（`contextMenus.onClicked` の `info` / `tab` から作る） */
export interface ClickTarget {
  tabId: number | undefined;
  tabTitle: string | undefined;
  frameId: number;
  /** 入力欄・contenteditable 内でのクリック（`info.editable`） */
  editable: boolean;
  /** Chrome が渡す選択テキスト（`info.selectionText`）。選択がなければ undefined / 空 */
  selectionText: string | undefined;
}

/** background の副作用（Chrome API・ストレージ）。テストでは差し替える */
export interface PrepareJobDeps {
  /** `scripting.executeScript` で注入し、戻り値を返す。読み取れないページでは reject する */
  runScript(file: InjectedScript, target: { tabId: number; frameId: number }): Promise<unknown>;
  /** 設定の最大入力文字数 */
  getMaxInputChars(): Promise<number>;
  /** 設定の除外ドメイン（正規化済みのパターン） */
  getExcludedDomains(): Promise<string[]>;
}

/**
 * クリックされたページから選択テキストまたは本文を取得してジョブを作る（docs/tech-stack.md §4.2 手順 4〜6）。
 * 選択テキストがあれば選択範囲、なければページ本文を対象にする（docs/spec.md §3.1）。
 */
export async function prepareJob(
  target: ClickTarget,
  context: JobContext,
  deps: PrepareJobDeps,
): Promise<Job> {
  // 除外ドメインはコンテンツを取得する前に、ページ URL とフレーム URL の両方で判定する
  const excludedDomains = await deps.getExcludedDomains();
  if (isExcludedPage(context, excludedDomains)) {
    return createErrorJob(context, "excludedDomain");
  }
  // 入力欄・contenteditable 内の選択は送らない
  if (target.editable) {
    return createErrorJob(context, "editable");
  }

  const hasSelection = target.selectionText !== undefined && target.selectionText !== "";
  const content = hasSelection
    ? await extractSelection(target, context, deps)
    : await extractPage(target, deps);
  if (content === "editable" || content === "unreadablePage") {
    return createErrorJob(context, content);
  }
  // クリック後に除外ドメインへ遷移していた場合も送らない（取得した文書の URL でも判定する）
  if (isExcludedUrl(content.url, excludedDomains)) {
    return createErrorJob(context, "excludedDomain");
  }

  const source = createJobSource(content, await deps.getMaxInputChars());
  return source ? createContentJob(context, source) : createErrorJob(context, "emptyContent");
}

async function extractPage(
  target: ClickTarget,
  deps: PrepareJobDeps,
): Promise<ExtractedContent | "unreadablePage"> {
  const result = await runScript("/extract.js", target, deps);
  const extraction = PageExtractionSchema.safeParse(result);
  if (!extraction.success) {
    // chrome:// やウェブストアなど、拡張から読み取れないページ
    return "unreadablePage";
  }
  return { type: "page", ...extraction.data };
}

/**
 * 選択テキストを取得する。改行を保つため注入スクリプトの `getSelection().toString()` を優先し、
 * 注入できない・選択を読めない場合（PDF ビューア等）は Chrome が渡す `info.selectionText` にフォールバックする。
 * 注入スクリプトが入力欄・編集可能要素での選択と判定した場合はフォールバックせず拒否する。
 */
async function extractSelection(
  target: ClickTarget,
  context: JobContext,
  deps: PrepareJobDeps,
): Promise<ExtractedContent | "editable"> {
  const result = await runScript("/extract-selection.js", target, deps);
  const extraction = SelectionExtractionSchema.safeParse(result);
  if (extraction.success) {
    const { editable, ...selection } = extraction.data;
    if (editable) {
      return "editable";
    }
    if (selection.text.trim() !== "") {
      return { type: "selection", method: "selection", ...selection };
    }
  }

  const text = target.selectionText ?? "";
  return {
    type: "selection",
    method: "selection",
    title: target.tabTitle ?? "",
    url: context.frameUrl ?? context.pageUrl,
    text,
    originalLength: text.length,
  };
}

async function runScript(
  file: InjectedScript,
  target: ClickTarget,
  deps: PrepareJobDeps,
): Promise<unknown> {
  const { tabId, frameId } = target;
  if (tabId === undefined || tabId < 0) {
    return undefined;
  }
  try {
    return await deps.runScript(file, { tabId, frameId });
  } catch {
    return undefined;
  }
}
