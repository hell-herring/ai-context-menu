import { type Browser, browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { buildMenuItems, handleMenuClick, type MenuItemDefinition } from "../lib/context-menu";
import { t } from "../lib/i18n";
import type { JobContext } from "../lib/job/create";
import { type ClickTarget, type PrepareJobDeps, prepareJob } from "../lib/job/prepare";
import type { PresetId } from "../lib/prompt/presets";
import { JobWriter } from "../lib/storage/session";
import { getCoreSettings, getExcludedDomains } from "../lib/storage/settings";

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
    onMenuClicked(jobs, info, tab, (windowId) => browser.sidePanel.open({ windowId }));
  });

  // E2E 用ビルドのみ。本番ビルドでは条件が定数になり、分岐ごと除去される
  if (import.meta.env.MODE === "e2e") {
    void import("../testing/e2e-background").then(({ installE2EHooks }) =>
      // Playwright からはユーザー操作として sidePanel.open() を呼べないため、サイドパネルはテストがタブで開く
      // （sidePanel.open() を await より前に呼ぶ規約は lib/context-menu.test.ts で検査している）
      installE2EHooks((info, tab) => onMenuClicked(jobs, info, tab, async () => {})),
    );
  }
});

/** コンテキストメニューのクリック処理。対象外のクリックでは undefined */
function onMenuClicked(
  jobs: JobWriter,
  info: Browser.contextMenus.OnClickData,
  tab: Browser.tabs.Tab | undefined,
  openSidePanel: (windowId: number) => Promise<void>,
): Promise<void> | undefined {
  // クリック受付時点の世代と時刻（sidePanel.open() より前に await を挟まないこと）
  const windowId = tab?.windowId;
  const seq = windowId === undefined ? 0 : jobs.nextSeq(windowId);
  const createdAt = Date.now();

  return handleMenuClick(
    { menuItemId: info.menuItemId, windowId },
    {
      openSidePanel,
      onSidePanelOpened: async ({ presetId, windowId }) => {
        const context = createJobContext(info, { presetId, windowId, seq, createdAt });
        const job = await prepareJob(clickTarget(info, tab), context, prepareJobDeps);
        await jobs.write(job);
      },
      onSidePanelOpenFailed: (error) => {
        console.error("Failed to open side panel", error);
      },
    },
  )?.catch((error: unknown) => {
    console.error("Failed to handle context menu click", error);
  });
}

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

/** background の副作用（Chrome API・ストレージ）。判定ロジックは lib/job/prepare.ts */
const prepareJobDeps: PrepareJobDeps = {
  async runScript(file, { tabId, frameId }) {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: [file],
    });
    return injection?.result;
  },
  async getMaxInputChars() {
    return (await getCoreSettings()).maxInputChars;
  },
  getExcludedDomains,
};

function clickTarget(
  info: Browser.contextMenus.OnClickData,
  tab: Browser.tabs.Tab | undefined,
): ClickTarget {
  return {
    tabId: tab?.id,
    tabTitle: tab?.title,
    frameId: info.frameId ?? 0,
    editable: info.editable,
    selectionText: info.selectionText,
  };
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
