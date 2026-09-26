import { type Browser, browser } from "wxt/browser";
import { presetMenuItemId } from "../lib/context-menu";
import type { PresetId } from "../lib/prompt/presets";

// E2E 用ビルド専用。Playwright からはネイティブのコンテキストメニューを操作できないため、
// 拡張のページからのメッセージで本番と同じクリック処理を呼べるようにする。本番ビルドには含めない
// （Playwright は拡張の Service Worker を検出できないことがあるため、Service Worker を直接操作しない）

/** E2E テストが送るメッセージの種別 */
export const CLICK_MENU_MESSAGE = "__AICM_TEST_ONLY__clickMenu";

type MenuClickHandler = (
  info: Browser.contextMenus.OnClickData,
  tab: Browser.tabs.Tab | undefined,
) => Promise<void> | undefined;

interface ClickMenuMessage {
  type: typeof CLICK_MENU_MESSAGE;
  /** クリックしたタブの URL */
  url: string;
  presetId: PresetId;
}

function isClickMenuMessage(message: unknown): message is ClickMenuMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === CLICK_MENU_MESSAGE
  );
}

export function installE2EHooks(onMenuClicked: MenuClickHandler): void {
  /** `url` のタブでメニューをクリックしたときの処理を行い、ジョブの書き込みまで待つ */
  const clickMenu = async ({ url, presetId }: ClickMenuMessage) => {
    // tabs.query の url は一致パターンでフラグメントを扱えないため、URL を完全一致で探す
    const tab = (await browser.tabs.query({})).find((candidate) => candidate.url === url);
    if (!tab) {
      throw new Error(`Tab not found: ${url}`);
    }
    const [selection] = await browser.scripting.executeScript({
      target: { tabId: tab.id ?? -1 },
      func: () => window.getSelection()?.toString() ?? "",
    });
    const selectionText = typeof selection?.result === "string" ? selection.result : "";
    await onMenuClicked(
      {
        menuItemId: presetMenuItemId(presetId),
        editable: false,
        frameId: 0,
        pageUrl: tab.url,
        frameUrl: tab.url,
        ...(selectionText === "" ? {} : { selectionText }),
      },
      tab,
    );
  };

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 自分の拡張のページからのメッセージだけを受け付ける
    if (sender.id !== browser.runtime.id || !isClickMenuMessage(message)) {
      return undefined;
    }
    clickMenu(message).then(
      () => sendResponse({ ok: true }),
      (error: unknown) => sendResponse({ ok: false, error: String(error) }),
    );
    return true;
  });
}
