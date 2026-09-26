import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { createErrorJob, type JobContext, MAX_JOB_BYTES } from "../job/create";
import type { Job } from "./schema";
import { JobWriter, jobStorageKey, readJob, removeJob, watchJob } from "./session";

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
    kind: "content",
    source: {
      type: "page",
      method: "text",
      title: "t",
      displayUrl: "https://example.com/",
      providerUrl: "https://example.com/",
      text,
      originalLength: text.length,
      inputLimit: 50_000,
      oversize: false,
      oversizeReasons: [],
    },
  };
}

beforeEach(() => {
  fakeBrowser.reset();
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
    expect(await readJob(1)).toEqual({ ...ctx, kind: "error", error: "tooLarge" });
  });

  it("書き込みに失敗したら小さなエラージョブを書き込む", async () => {
    const writer = new JobWriter();
    const ctx = context(1, writer.nextSeq(1));
    const set = browser.storage.session.set.bind(browser.storage.session);
    vi.spyOn(browser.storage.session, "set").mockRejectedValueOnce(new Error("QUOTA"));
    vi.spyOn(browser.storage.session, "set").mockImplementation(set);

    expect(await writer.write(contentJob(ctx, "body"))).toBe("written");
    expect(await readJob(1)).toEqual({ ...ctx, kind: "error", error: "tooLarge" });
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
