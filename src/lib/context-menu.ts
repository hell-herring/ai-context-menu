import type { MessageKey } from "./i18n";
import { isPresetId, PRESET_IDS, PRESET_MENU_TITLE_KEYS, type PresetId } from "./prompt/presets";

export const PARENT_MENU_ID = "aicm";

const PRESET_MENU_ID_PREFIX = `${PARENT_MENU_ID}:`;

type MenuContext = "selection" | "page";

export interface MenuItemDefinition {
  id: string;
  parentId?: string;
  titleKey: MessageKey;
  contexts: [MenuContext, ...MenuContext[]];
}

/** 選択範囲があれば選択範囲、なければページ本文を対象にする（docs/spec.md §3.1） */
function menuContexts(): MenuItemDefinition["contexts"] {
  return ["selection", "page"];
}

/** 登録するコンテキストメニュー項目（親 → 子の順。親を先に作成する必要がある） */
export function buildMenuItems(): MenuItemDefinition[] {
  return [
    { id: PARENT_MENU_ID, titleKey: "extName", contexts: menuContexts() },
    ...PRESET_IDS.map((presetId) => ({
      id: presetMenuItemId(presetId),
      parentId: PARENT_MENU_ID,
      titleKey: PRESET_MENU_TITLE_KEYS[presetId],
      contexts: menuContexts(),
    })),
  ];
}

export function presetMenuItemId(presetId: PresetId): string {
  return `${PRESET_MENU_ID_PREFIX}${presetId}`;
}

/** メニュー項目 ID からプリセット ID を得る。拡張のプリセット項目でなければ undefined */
export function presetIdFromMenuItemId(menuItemId: string | number): PresetId | undefined {
  if (typeof menuItemId !== "string" || !menuItemId.startsWith(PRESET_MENU_ID_PREFIX)) {
    return undefined;
  }
  const presetId = menuItemId.slice(PRESET_MENU_ID_PREFIX.length);
  return isPresetId(presetId) ? presetId : undefined;
}

export interface MenuClick {
  menuItemId: string | number;
  windowId: number | undefined;
}

export interface MenuClickDeps {
  /** `sidePanel.open()`。ユーザー操作のコンテキスト内で同期的に呼ばれる */
  openSidePanel(windowId: number): Promise<void>;
  /** サイドパネルが開けた後の処理（M1 以降: 除外判定・抽出・ジョブ書き込み） */
  onSidePanelOpened(click: { presetId: PresetId; windowId: number }): Promise<void>;
  /** サイドパネルを開けなかった場合。以降の処理は行わない */
  onSidePanelOpenFailed(error: unknown): void;
}

/**
 * `contextMenus.onClicked` の処理。
 *
 * `sidePanel.open()` はユーザー操作（クリック）のコンテキストを失うと失敗するため、
 * **await を挟まずに最初に呼び**、その Promise を保持して後で待つ。
 * 開けなかった場合は抽出・ジョブ書き込みをせず中止する（docs/tech-stack.md §4.2 手順 1〜3）。
 *
 * 対象外のクリックでは何もせず undefined を返す。
 */
export function handleMenuClick(click: MenuClick, deps: MenuClickDeps): Promise<void> | undefined {
  const presetId = presetIdFromMenuItemId(click.menuItemId);
  const { windowId } = click;
  if (presetId === undefined || windowId === undefined || windowId < 0) {
    return undefined;
  }

  const opening = deps.openSidePanel(windowId);

  return (async () => {
    try {
      await opening;
    } catch (error) {
      deps.onSidePanelOpenFailed(error);
      return;
    }
    await deps.onSidePanelOpened({ presetId, windowId });
  })();
}
