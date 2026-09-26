import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  clearRecentSummaries,
  createRecentSummary,
  listRecentSummaries,
  parseRecentSummaries,
  recentKeysToRemove,
  recentStorageKey,
  saveRecentSummary,
  truncateUtf8,
  watchRecentSummaries,
} from "./recent";
import { RECENT_LIMITS, type RecentSummary } from "./schema";

function summary(createdAt: number, text = "## 要約"): RecentSummary {
  return createRecentSummary(
    {
      id: crypto.randomUUID(),
      createdAt,
      sourceType: "page",
      title: "記事",
      displayUrl: "https://example.com/article?id=1",
      provider: "anthropic",
      model: "claude-opus-5",
      presetId: "summary",
      stopReason: "end",
    },
    text,
  );
}

function entries(...summaries: RecentSummary[]): Record<string, unknown> {
  return Object.fromEntries(summaries.map((s) => [recentStorageKey(s.id), s]));
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("truncateUtf8", () => {
  it("上限以内ならそのまま", () => {
    expect(truncateUtf8("あいう", 9)).toEqual({ text: "あいう", truncated: false });
  });

  it("UTF-8 のバイト数で切り詰め、文字の途中では切らない", () => {
    // 「あ」は 3 バイト
    expect(truncateUtf8("あいう", 8)).toEqual({ text: "あい", truncated: true });
    // 絵文字（サロゲートペア）は 4 バイト。分割しない
    expect(truncateUtf8("a😀b", 4)).toEqual({ text: "a", truncated: true });
  });

  it("保存する値の結果テキストを上限に収める", () => {
    const long = summary(1, "あ".repeat(RECENT_LIMITS.textBytes));
    expect(long.truncated).toBe(true);
    expect(new TextEncoder().encode(long.text).length).toBeLessThanOrEqual(RECENT_LIMITS.textBytes);
    expect(summary(1).truncated).toBe(false);
  });
});

describe("recentKeysToRemove / parseRecentSummaries", () => {
  it("新しい順に上限を超えた古いものを削除する", () => {
    const items = Array.from({ length: 12 }, (_, i) => summary(i));
    const remove = recentKeysToRemove(entries(...items), 10);
    expect(remove.sort()).toEqual(
      items
        .slice(0, 2)
        .map((s) => recentStorageKey(s.id))
        .sort(),
    );
  });

  it("不正な値・キーと ID が一致しない値は削除し、一覧に出さない", () => {
    const valid = summary(1);
    const other = summary(2);
    const items = {
      ...entries(valid),
      "recent.broken": { version: 1, text: "x" },
      [recentStorageKey(crypto.randomUUID())]: other,
      "job.1": { kind: "error" },
    };
    expect(recentKeysToRemove(items).sort()).toEqual(
      Object.keys(items)
        .filter((key) => key.startsWith("recent.") && key !== recentStorageKey(valid.id))
        .sort(),
    );
    expect(parseRecentSummaries(items)).toEqual([valid]);
  });

  it("一覧は新しい順", () => {
    const [a, b, c] = [summary(2), summary(3), summary(1)];
    expect(parseRecentSummaries(entries(a, b, c))).toEqual([b, a, c]);
  });
});

describe("saveRecentSummary / listRecentSummaries / clearRecentSummaries", () => {
  it(`最大 ${RECENT_LIMITS.count} 件を保持し、古いものから削除する`, async () => {
    const items = Array.from({ length: RECENT_LIMITS.count + 2 }, (_, i) => summary(i));
    for (const item of items) {
      await saveRecentSummary(item);
    }
    expect(await listRecentSummaries()).toEqual(items.slice(2).reverse());
  });

  it("同じジョブの結果は置き換える", async () => {
    const first = summary(1, "最初");
    await saveRecentSummary(first);
    const regenerated = { ...first, createdAt: 2, text: "再生成" };
    await saveRecentSummary(regenerated);
    expect(await listRecentSummaries()).toEqual([regenerated]);
  });

  it("すべて削除しても、ジョブは残す", async () => {
    await saveRecentSummary(summary(1));
    await browser.storage.session.set({ "job.1": { kind: "error" } });
    await clearRecentSummaries();
    expect(await listRecentSummaries()).toEqual([]);
    expect(await browser.storage.session.get(null)).toEqual({ "job.1": { kind: "error" } });
  });
});

describe("watchRecentSummaries", () => {
  it("最近の要約の変更だけを通知する", async () => {
    const onChange = vi.fn();
    const unwatch = watchRecentSummaries(onChange);

    await browser.storage.session.set({ "job.1": { kind: "error" } });
    expect(onChange).not.toHaveBeenCalled();
    await saveRecentSummary(summary(1));
    expect(onChange).toHaveBeenCalledOnce();

    unwatch();
    await clearRecentSummaries();
    expect(onChange).toHaveBeenCalledOnce();
  });
});
