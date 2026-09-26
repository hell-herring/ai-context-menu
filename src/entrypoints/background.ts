import { type Browser, browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { buildMenuItems, handleMenuClick, type MenuItemDefinition } from "../lib/context-menu";
import { PageExtractionSchema } from "../lib/extract/schema";
import { t } from "../lib/i18n";
import {
  createContentJob,
  createErrorJob,
  createJobSource,
  type JobContext,
} from "../lib/job/create";
import type { PresetId } from "../lib/prompt/presets";
import { JobWriter } from "../lib/storage/session";
import { getCoreSettings } from "../lib/storage/settings";

export default defineBackground(() => {
  const jobs = new JobWriter();

  browser.runtime.onInstalled.addListener(({ reason }) => {
    registerMenus().catch((error: unknown) => {
      console.error("Failed to register context menus", error);
    });
    // 初回インストール時は API キー登録のため設定画面を開く
    if (reason === "install") {
      browser.runtime.openOptionsPage().catch((error: unknown) => {
        console.error("Failed to open options page", error);
      });
    }
  });

  // リスナーはトップレベルで同期的に登録する（Service Worker 再起動後もイベントを受け取るため）
  browser.contextMenus.onClicked.addListener((info, tab) => {
    // クリック受付時点の世代と時刻（sidePanel.open() より前に await を挟まないこと）
    const windowId = tab?.windowId;
    const seq = windowId === undefined ? 0 : jobs.nextSeq(windowId);
    const createdAt = Date.now();

    handleMenuClick(
      { menuItemId: info.menuItemId, windowId },
      {
        openSidePanel: (windowId) => browser.sidePanel.open({ windowId }),
        onSidePanelOpened: async ({ presetId, windowId }) => {
          const context = createJobContext(info, { presetId, windowId, seq, createdAt });
          const job = await prepareJob(info, tab, context);
          await jobs.write(job);
        },
        onSidePanelOpenFailed: (error) => {
          console.error("Failed to open side panel", error);
        },
      },
    )?.catch((error: unknown) => {
      console.error("Failed to handle context menu click", error);
    });
  });
});

function createJobContext(
  info: Browser.contextMenus.OnClickData,
  click: { presetId: PresetId; windowId: number; seq: number; createdAt: number },
): JobContext {
  return {
    id: crypto.randomUUID(),
    ...click,
    pageUrl: info.pageUrl ?? "",
    frameUrl: info.frameUrl,
  };
}

/** クリックされたページから本文を取得してジョブを作る（docs/tech-stack.md §4.2 手順 4〜6） */
async function prepareJob(
  info: Browser.contextMenus.OnClickData,
  tab: Browser.tabs.Tab | undefined,
  context: JobContext,
) {
  // 入力欄・contenteditable 内の選択は送らない
  if (info.editable) {
    return createErrorJob(context, "editable");
  }
  // 選択テキストの要約は M2 で実装する。選択があるときにページ全体を送らないよう中止する
  if (info.selectionText !== undefined && info.selectionText !== "") {
    return createErrorJob(context, "selectionUnsupported");
  }

  const tabId = tab?.id;
  if (tabId === undefined || tabId < 0) {
    return createErrorJob(context, "unreadablePage");
  }

  let result: unknown;
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId, frameIds: [info.frameId ?? 0] },
      files: ["/extract.js"],
    });
    result = injection?.result;
  } catch {
    // chrome:// やウェブストアなど、拡張から読み取れないページ
    return createErrorJob(context, "unreadablePage");
  }

  const extraction = PageExtractionSchema.safeParse(result);
  if (!extraction.success) {
    return createErrorJob(context, "unreadablePage");
  }

  const { maxInputChars } = await getCoreSettings();
  const source = createJobSource({ type: "page", ...extraction.data }, maxInputChars);
  return source ? createContentJob(context, source) : createErrorJob(context, "emptyContent");
}

async function registerMenus(): Promise<void> {
  await browser.contextMenus.removeAll();
  for (const item of buildMenuItems()) {
    await createMenu(item);
  }
}

// contextMenus.create は Promise を返さないため、コールバックで完了とエラーを受け取る
function createMenu(item: MenuItemDefinition): Promise<void> {
  return new Promise((resolve, reject) => {
    browser.contextMenus.create(
      {
        id: item.id,
        parentId: item.parentId,
        title: t(item.titleKey),
        contexts: item.contexts,
      },
      () => {
        const error = browser.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
        } else {
          resolve();
        }
      },
    );
  });
}
