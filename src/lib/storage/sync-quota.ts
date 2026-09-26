import { browser } from "wxt/browser";

// storage.sync の容量制限（docs/tech-stack.md §3）。
// 文字数上限だけでは多バイト文字で超過しうるため、書き込み前に UTF-8 バイト数を検査する。

/** 1 項目の上限（QUOTA_BYTES_PER_ITEM = 8,192 に余裕を持たせる） */
export const SYNC_ITEM_MAX_BYTES = 7_000;

/** 全体の上限（QUOTA_BYTES = 102,400 に余裕を持たせる） */
export const SYNC_TOTAL_MAX_BYTES = 80_000;

export type SyncQuotaExceeded = "item" | "total";

/** storage.sync の書き込みが容量上限を超える。理由は設定画面で表示する */
export class SyncQuotaError extends Error {
  readonly reason: SyncQuotaExceeded;

  constructor(reason: SyncQuotaExceeded) {
    super(`storage.sync quota exceeded: ${reason}`);
    this.name = "SyncQuotaError";
    this.reason = reason;
  }
}

/** Chrome と同じく、キーの長さと値を JSON 化した長さの和（UTF-8 バイト数）で数える */
export function syncItemBytes(key: string, value: unknown): number {
  const encoder = new TextEncoder();
  return encoder.encode(key).length + encoder.encode(JSON.stringify(value)).length;
}

/** 容量上限を検査してから storage.sync に書き込む。超える場合は SyncQuotaError を投げる */
export async function setSyncItem(key: string, value: unknown): Promise<void> {
  if (syncItemBytes(key, value) > SYNC_ITEM_MAX_BYTES) {
    throw new SyncQuotaError("item");
  }
  const stored = await browser.storage.sync.get(null);
  let total = 0;
  for (const [storedKey, storedValue] of Object.entries(stored)) {
    if (storedKey !== key) {
      total += syncItemBytes(storedKey, storedValue);
    }
  }
  if (total + syncItemBytes(key, value) > SYNC_TOTAL_MAX_BYTES) {
    throw new SyncQuotaError("total");
  }
  await browser.storage.sync.set({ [key]: value });
}
