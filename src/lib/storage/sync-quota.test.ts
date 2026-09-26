import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  SYNC_ITEM_MAX_BYTES,
  SYNC_TOTAL_MAX_BYTES,
  setSyncItem,
  syncItemBytes,
} from "./sync-quota";

beforeEach(() => {
  fakeBrowser.reset();
});

describe("syncItemBytes", () => {
  it("キーと JSON 化した値の UTF-8 バイト数の和", () => {
    expect(syncItemBytes("k", "あ")).toBe(1 + 5);
  });
});

describe("setSyncItem", () => {
  it("上限内なら書き込む", async () => {
    await setSyncItem("key", { a: 1 });
    expect(await browser.storage.sync.get("key")).toEqual({ key: { a: 1 } });
  });

  it("1 項目の上限を多バイト文字で超える場合は書き込まない", async () => {
    // 文字数は上限未満でも UTF-8 では上限を超える
    const value = "あ".repeat(SYNC_ITEM_MAX_BYTES / 2);
    await expect(setSyncItem("key", value)).rejects.toMatchObject({ reason: "item" });
    expect(await browser.storage.sync.get(null)).toEqual({});
  });

  it("全体の上限を超える場合は書き込まない（置き換える項目自身は数えない）", async () => {
    const chunk = "x".repeat(SYNC_ITEM_MAX_BYTES - 100);
    const count = Math.floor(SYNC_TOTAL_MAX_BYTES / SYNC_ITEM_MAX_BYTES);
    for (let i = 0; i < count; i++) {
      await browser.storage.sync.set({ [`k${i}`]: chunk });
    }
    await expect(setSyncItem("new", chunk)).rejects.toMatchObject({ reason: "total" });
    await expect(setSyncItem("k0", chunk)).resolves.toBeUndefined();
  });
});
