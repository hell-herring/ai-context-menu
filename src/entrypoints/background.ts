import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { buildMenuItems, handleMenuClick, type MenuItemDefinition } from "../lib/context-menu";
import { t } from "../lib/i18n";

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    registerMenus().catch((error: unknown) => {
      console.error("Failed to register context menus", error);
    });
  });

  // リスナーはトップレベルで同期的に登録する（Service Worker 再起動後もイベントを受け取るため）
  browser.contextMenus.onClicked.addListener((info, tab) => {
    handleMenuClick(
      { menuItemId: info.menuItemId, windowId: tab?.windowId },
      {
        openSidePanel: (windowId) => browser.sidePanel.open({ windowId }),
        // M0 ではサイドパネルを開くだけ。抽出・ジョブ書き込みは M1 で実装する
        onSidePanelOpened: async () => {},
        onSidePanelOpenFailed: (error) => {
          console.error("Failed to open side panel", error);
        },
      },
    )?.catch((error: unknown) => {
      console.error("Failed to handle context menu click", error);
    });
  });
});

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
