import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { createErrorJob, type JobContext, MAX_JOB_BYTES } from "../job/create";
import { createRecentSummary, listRecentSummaries, recentStorageKey } from "./recent";
import type { Job, RecentSummary } from "./schema";
import {
  JobWriter,
  jobStorageKey,
  MAX_SESSION_BYTES,
  planSessionCapacity,
  readJob,
  removeJob,
  watchJob,
} from "./session";

function context(windowId: number, seq: number): JobContext {
  return {
    id: crypto.randomUUID(),
    windowId,
    seq,
    createdAt: Date.now(),
    presetId: "summary",
    pageUrl: "https://example.com/",
  };
}

function contentJob(ctx: JobContext, text: string): Job {
  return {
    ...ctx,
    hostnames: ["example.com"],
    kind: "content",
    source: {
      type: "page",
      method: "text",
      title: "t",
      displayUrl: "https://example.com/",
      providerUrl: "https://example.com/",
      hostname: "example.com",
      text,
      originalLength: text.length,
      inputLimit: 50_000,
      oversize: false,
      oversizeReasons: [],
    },
  };
}

function recentSummary(createdAt: number, text = "## 要約"): RecentSummary {
  return createRecentSummary(
    {
      id: crypto.randomUUID(),
      createdAt,
      sourceType: "page",
      title: "t",
      displayUrl: "https://example.com/",
      provider: "anthropic",
      model: "claude-opus-5",
      presetId: "summary",
      stopReason: "end",
    },
    text,
  );
}

async function saveRecent(summary: RecentSummary): Promise<void> {
  await browser.storage.session.set({ [recentStorageKey(summary.id)]: summary });
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("planSessionCapacity", () => {
  const recents = [
    { key: "recent.b", bytes: 30, createdAt: 2 },
    { key: "recent.a", bytes: 30, createdAt: 1 },
    { key: "recent.c", bytes: 30, createdAt: 3 },
  ];

  it("収まれば何も削除しない", () => {
    expect(
      planSessionCapacity({ used: 90, replaced: 0, incoming: 10, recents, limit: 100 }),
    ).toEqual({ fits: true, remove: [] });
  });

  it("置き換える既存のジョブの分は差し引く", () => {
    expect(
      planSessionCapacity({ used: 100, replaced: 20, incoming: 20, recents, limit: 100 }),
    ).toEqual({ fits: true, remove: [] });
  });

  it("超える分だけ、最近の要約を古いものから削除する", () => {
    expect(
      planSessionCapacity({ used: 100, replaced: 0, incoming: 40, recents, limit: 100 }),
    ).toEqual({ fits: true, remove: ["recent.a", "recent.b"] });
  });

  it("すべて削除しても収まらなければ、何も削除しない", () => {
    expect(
      planSessionCapacity({ used: 100, replaced: 0, incoming: 100, recents, limit: 100 }),
    ).toEqual({ fits: false, remove: [] });
  });
});

describe("JobWriter", () => {
  it("最新のクリックのジョブだけを書き込む（古いクリックが後から完了しても上書きしない）", async () => {
    const writer = new JobWriter();
    const first = writer.nextSeq(1);
    const second = writer.nextSeq(1);

    const newer = createErrorJob(context(1, second), "emptyContent");
    const older = createErrorJob(context(1, first), "unreadablePage");
    expect(await writer.write(newer)).toBe("written");
    expect(await writer.write(older)).toBe("superseded");

    expect(await readJob(1)).toEqual(newer);
  });

  it("連番はウィンドウごとに独立している", () => {
    const writer = new JobWriter();
    expect(writer.nextSeq(1)).toBe(1);
    expect(writer.nextSeq(2)).toBe(1);
    expect(writer.nextSeq(1)).toBe(2);
  });

  it("大きすぎるジョブは書き込まず、エラージョブにする", async () => {
    const writer = new JobWriter();
    const ctx = context(1, writer.nextSeq(1));
    await writer.write(contentJob(ctx, "x".repeat(MAX_JOB_BYTES)));
    expect(await readJob(1)).toEqual({
      ...ctx,
      hostnames: ["example.com"],
      kind: "error",
      error: "tooLarge",
    });
  });

  it("書き込みに失敗したら最近の要約を削除して 1 回だけ再試行する", async () => {
    await saveRecent(recentSummary(1));
    const writer = new JobWriter();
    const ctx = context(1, writer.nextSeq(1));
    const set = browser.storage.session.set.bind(browser.storage.session);
    vi.spyOn(browser.storage.session, "set")
      .mockRejectedValueOnce(new Error("QUOTA"))
      .mockImplementation(set);

    const job = contentJob(ctx, "body");
    expect(await writer.write(job)).toBe("written");
    expect(await readJob(1)).toEqual(job);
    expect(await listRecentSummaries()).toEqual([]);
  });

  it("再試行も失敗したら小さなエラージョブを書き込む", async () => {
    const writer = new JobWriter();
    const ctx = context(1, writer.nextSeq(1));
    const set = browser.storage.session.set.bind(browser.storage.session);
    vi.spyOn(browser.storage.session, "set")
      .mockRejectedValueOnce(new Error("QUOTA"))
      .mockRejectedValueOnce(new Error("QUOTA"))
      .mockImplementation(set);

    expect(await writer.write(contentJob(ctx, "body"))).toBe("written");
    expect(await readJob(1)).toEqual({
      ...ctx,
      hostnames: ["example.com"],
      kind: "error",
      error: "tooLarge",
    });
  });

  describe("storage.session 全体の容量", () => {
    /** 実際の使用量に `extra` バイトを足した値を返す（他のウィンドウの大きなジョブの代わり） */
    function mockBytesInUse(extra: number) {
      vi.spyOn(browser.storage.session, "getBytesInUse").mockImplementation(async (keys) => {
        const items = await browser.storage.session.get(keys ?? null);
        const bytes = Object.entries(items).reduce(
          (sum, [key, value]) => sum + new TextEncoder().encode(key + JSON.stringify(value)).length,
          0,
        );
        return keys === null || keys === undefined ? bytes + extra : bytes;
      });
    }

    it("足りなければ最近の要約を古いものから削除して書き込む", async () => {
      const older = recentSummary(1, "x".repeat(100_000));
      const newer = recentSummary(2, "x".repeat(100_000));
      await saveRecent(older);
      await saveRecent(newer);
      mockBytesInUse(MAX_SESSION_BYTES - 150_000);

      const writer = new JobWriter();
      const job = contentJob(context(1, writer.nextSeq(1)), "body");
      expect(await writer.write(job)).toBe("written");
      expect(await readJob(1)).toEqual(job);
      expect(await listRecentSummaries()).toEqual([newer]);
    });

    it("最近の要約をすべて削除しても足りなければ、何も削除せずにエラージョブを書き込む", async () => {
      const recent = recentSummary(1, "x".repeat(1_000));
      await saveRecent(recent);
      mockBytesInUse(MAX_SESSION_BYTES);

      const writer = new JobWriter();
      const ctx = context(1, writer.nextSeq(1));
      expect(await writer.write(contentJob(ctx, "body"))).toBe("written");
      expect(await readJob(1)).toEqual({
        ...ctx,
        hostnames: ["example.com"],
        kind: "error",
        error: "tooManyJobs",
      });
      expect(await listRecentSummaries()).toEqual([recent]);
    });
  });

  it("書き込みは直列に行う", async () => {
    const writer = new JobWriter();
    const order: string[] = [];
    vi.spyOn(browser.storage.session, "set").mockImplementation(async (items) => {
      const [key] = Object.keys(items);
      order.push(`start ${key}`);
      await new Promise((resolve) => setTimeout(resolve, key === jobStorageKey(1) ? 10 : 0));
      order.push(`end ${key}`);
    });

    await Promise.all([
      writer.write(createErrorJob(context(1, writer.nextSeq(1)), "editable")),
      writer.write(createErrorJob(context(2, writer.nextSeq(2)), "editable")),
    ]);
    expect(order).toEqual(["start job.1", "end job.1", "start job.2", "end job.2"]);
  });
});

describe("readJob / removeJob / watchJob", () => {
  it("不正な値は無視する", async () => {
    await browser.storage.session.set({ [jobStorageKey(1)]: { kind: "content", text: "x" } });
    expect(await readJob(1)).toBeUndefined();
  });

  it("自分のウィンドウのジョブの書き込みだけを通知する", async () => {
    const onJob = vi.fn();
    const unwatch = watchJob(1, onJob);
    const mine = createErrorJob(context(1, 1), "editable");

    await browser.storage.session.set({
      [jobStorageKey(2)]: createErrorJob(context(2, 1), "editable"),
    });
    await browser.storage.session.set({ [jobStorageKey(1)]: mine });
    await removeJob(1);

    expect(onJob).toHaveBeenCalledExactlyOnceWith(mine);
    expect(await readJob(1)).toBeUndefined();

    unwatch();
    await browser.storage.session.set({ [jobStorageKey(1)]: mine });
    expect(onJob).toHaveBeenCalledOnce();
  });
});
