import { browser } from "wxt/browser";
import { RECENT_LIMITS, type RecentSummary, RecentSummarySchema } from "./schema";

// 最近の要約（storage.session。メモリのみ・ブラウザ終了で消える）。docs/tech-stack.md §4.2
// 複数のサイドパネルが同時に完了しても互いに上書きしないよう、1 結果 1 キーで保存する

const RECENT_KEY_PREFIX = "recent.";

export function recentStorageKey(id: string): string {
  return `${RECENT_KEY_PREFIX}${id}`;
}

export function isRecentStorageKey(key: string): boolean {
  return key.startsWith(RECENT_KEY_PREFIX);
}

/**
 * 結果テキストを UTF-8 で `maxBytes` 以内に収める（文字の途中では切らない）。
 * 収まらなければ先頭から収まるところまでにして `truncated` を返す
 */
export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = new Uint8Array(maxBytes);
  // encodeInto はサロゲートペアを分割しない
  const { read } = new TextEncoder().encodeInto(text, buffer);
  return read === text.length
    ? { text, truncated: false }
    : { text: text.slice(0, read), truncated: true };
}

/** 保存する値。結果テキストを上限に収める */
export function createRecentSummary(
  entry: Omit<RecentSummary, "version" | "text" | "truncated">,
  text: string,
): RecentSummary {
  return { version: 1, ...entry, ...truncateUtf8(text, RECENT_LIMITS.textBytes) };
}

/** storage.session の値から最近の要約を読み分ける（有効なものは新しい順、不正な値はキー） */
function readRecentItems(items: Record<string, unknown>): {
  summaries: RecentSummary[];
  invalidKeys: string[];
} {
  const summaries: RecentSummary[] = [];
  const invalidKeys: string[] = [];
  for (const [key, value] of Object.entries(items)) {
    if (!isRecentStorageKey(key)) {
      continue;
    }
    const parsed = RecentSummarySchema.safeParse(value);
    if (parsed.success && recentStorageKey(parsed.data.id) === key) {
      summaries.push(parsed.data);
    } else {
      invalidKeys.push(key);
    }
  }
  summaries.sort((a, b) => b.createdAt - a.createdAt);
  return { summaries, invalidKeys };
}

/** 保存済みの項目（新しい順）。不正な値は無視する */
export function parseRecentSummaries(items: Record<string, unknown>): RecentSummary[] {
  return readRecentItems(items).summaries;
}

/** 削除するキー（不正な値と、新しい順に `limit` 件を超えるもの） */
export function recentKeysToRemove(
  items: Record<string, unknown>,
  limit: number = RECENT_LIMITS.count,
): string[] {
  const { summaries, invalidKeys } = readRecentItems(items);
  return [...invalidKeys, ...summaries.slice(limit).map(({ id }) => recentStorageKey(id))];
}

// storage.session には job.<windowId> もあるが、ジョブは受け取った時点で削除するため通常は小さい。
// getKeys() は Chrome 130 以降のため、すべて読んでから絞り込む
async function readAllSession(): Promise<Record<string, unknown>> {
  return browser.storage.session.get(null);
}

/**
 * 結果を保存し、件数を超えた古いものを削除する（同時に保存して 1 件多く消えても許容する。
 * docs/tech-stack.md §4.2）
 */
export async function saveRecentSummary(summary: RecentSummary): Promise<void> {
  await browser.storage.session.set({ [recentStorageKey(summary.id)]: summary });
  const remove = recentKeysToRemove(await readAllSession());
  if (remove.length > 0) {
    await browser.storage.session.remove(remove);
  }
}

export async function listRecentSummaries(): Promise<RecentSummary[]> {
  return parseRecentSummaries(await readAllSession());
}

export async function clearRecentSummaries(): Promise<void> {
  const keys = Object.keys(await readAllSession()).filter(isRecentStorageKey);
  if (keys.length > 0) {
    await browser.storage.session.remove(keys);
  }
}

/** 最近の要約の変更（他のウィンドウのサイドパネルでの保存・削除を含む）を監視する。解除関数を返す */
export function watchRecentSummaries(onChange: () => void): () => void {
  const listener = (changes: Record<string, unknown>) => {
    if (Object.keys(changes).some(isRecentStorageKey)) {
      onChange();
    }
  };
  browser.storage.session.onChanged.addListener(listener);
  return () => browser.storage.session.onChanged.removeListener(listener);
}
