import { describe, expect, it, vi } from "vitest";
import {
  buildMenuItems,
  handleMenuClick,
  type MenuClickDeps,
  PARENT_MENU_ID,
  presetIdFromMenuItemId,
  presetMenuItemId,
} from "./context-menu";
import { PRESET_IDS } from "./prompt/presets";

function createDeps(openSidePanel: MenuClickDeps["openSidePanel"]) {
  return {
    openSidePanel: vi.fn(openSidePanel),
    onSidePanelOpened: vi.fn(async () => {}),
    onSidePanelOpenFailed: vi.fn(),
  } satisfies MenuClickDeps;
}

describe("buildMenuItems", () => {
  it("親項目を先頭に、各プリセットを子項目として selection / page に登録する", () => {
    expect(buildMenuItems()).toEqual([
      { id: "aicm", titleKey: "extName", contexts: ["selection", "page"] },
      {
        id: "aicm:summary",
        parentId: "aicm",
        titleKey: "menuSummary",
        contexts: ["selection", "page"],
      },
      {
        id: "aicm:tldr3",
        parentId: "aicm",
        titleKey: "menuTldr3",
        contexts: ["selection", "page"],
      },
      {
        id: "aicm:bullets",
        parentId: "aicm",
        titleKey: "menuBullets",
        contexts: ["selection", "page"],
      },
    ]);
  });

  it("項目 ID が重複しない", () => {
    const ids = buildMenuItems().map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("presetIdFromMenuItemId", () => {
  it.each(PRESET_IDS)("%s の項目 ID を往復変換できる", (presetId) => {
    expect(presetIdFromMenuItemId(presetMenuItemId(presetId))).toBe(presetId);
  });

  it.each([PARENT_MENU_ID, "aicm:", "aicm:unknown", "summary", "other:summary", 1])(
    "拡張のプリセット項目でない ID (%s) は undefined",
    (menuItemId) => {
      expect(presetIdFromMenuItemId(menuItemId)).toBeUndefined();
    },
  );
});

describe("handleMenuClick", () => {
  it("await を挟まず同期的に sidePanel.open() を呼び、開けたら後続処理に進む", async () => {
    const deps = createDeps(async () => {});

    const result = handleMenuClick({ menuItemId: "aicm:tldr3", windowId: 7 }, deps);

    // handleMenuClick から戻った時点（マイクロタスクを進める前）で呼ばれていること
    expect(deps.openSidePanel).toHaveBeenCalledExactlyOnceWith(7);
    expect(deps.onSidePanelOpened).not.toHaveBeenCalled();

    await result;
    expect(deps.onSidePanelOpened).toHaveBeenCalledExactlyOnceWith({
      presetId: "tldr3",
      windowId: 7,
    });
    expect(deps.onSidePanelOpenFailed).not.toHaveBeenCalled();
  });

  it("サイドパネルを開けなければ後続処理を行わない", async () => {
    const error = new Error("No user gesture");
    const deps = createDeps(() => Promise.reject(error));

    await handleMenuClick({ menuItemId: "aicm:summary", windowId: 1 }, deps);

    expect(deps.onSidePanelOpenFailed).toHaveBeenCalledExactlyOnceWith(error);
    expect(deps.onSidePanelOpened).not.toHaveBeenCalled();
  });

  it.each([
    { menuItemId: PARENT_MENU_ID, windowId: 1 },
    { menuItemId: "other", windowId: 1 },
    { menuItemId: "aicm:summary", windowId: undefined },
    { menuItemId: "aicm:summary", windowId: -1 },
  ])("対象外のクリック %o では何もしない", (click) => {
    const deps = createDeps(async () => {});

    expect(handleMenuClick(click, deps)).toBeUndefined();
    expect(deps.openSidePanel).not.toHaveBeenCalled();
  });
});
