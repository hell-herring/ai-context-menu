import { describe, expect, it } from "vitest";
import type { ContentJob, Job } from "../storage/schema";
import { isExcludedJob, JOB_MAX_AGE_MS, JobReceiver, needsConfirmation } from "./receive";

function job(overrides: Partial<Job> & Pick<Job, "id" | "seq" | "createdAt">): Job {
  return {
    windowId: 1,
    presetId: "summary",
    pageUrl: "https://example.com/",
    kind: "error",
    error: "emptyContent",
    ...overrides,
  } as Job;
}

describe("JobReceiver", () => {
  it("新しいジョブを受け付け、同じ ID は 2 回目以降無視する", () => {
    const receiver = new JobReceiver();
    const first = job({ id: "a", seq: 1, createdAt: 1_000 });
    expect(receiver.decide(first, 1_000)).toBe("accept");
    expect(receiver.decide(first, 1_000)).toBe("duplicate");
  });

  it("処理済みより前のクリックのジョブは無視する", () => {
    const receiver = new JobReceiver();
    expect(receiver.decide(job({ id: "b", seq: 2, createdAt: 2_000 }), 2_000)).toBe("accept");
    expect(receiver.decide(job({ id: "a", seq: 1, createdAt: 1_000 }), 2_000)).toBe("stale");
  });

  it("Service Worker 再起動で seq がリセットされても、後のクリックなら受け付ける", () => {
    const receiver = new JobReceiver();
    expect(receiver.decide(job({ id: "a", seq: 5, createdAt: 1_000 }), 1_000)).toBe("accept");
    expect(receiver.decide(job({ id: "b", seq: 1, createdAt: 2_000 }), 2_000)).toBe("accept");
  });

  it("作成から一定時間経過したジョブは破棄する", () => {
    const receiver = new JobReceiver();
    const old = job({ id: "a", seq: 1, createdAt: 0 });
    expect(receiver.decide(old, JOB_MAX_AGE_MS)).toBe("expired");
    expect(receiver.decide(job({ id: "b", seq: 2, createdAt: 1 }), JOB_MAX_AGE_MS)).toBe("accept");
  });
});

const base: ContentJob = {
  id: "a",
  windowId: 1,
  seq: 1,
  createdAt: 0,
  presetId: "summary",
  pageUrl: "https://news.example/",
  hostnames: ["news.example"],
  kind: "content",
  source: {
    type: "page",
    method: "text",
    title: "t",
    displayUrl: "https://news.example/",
    providerUrl: "https://news.example/",
    hostname: "news.example",
    text: "本文",
    originalLength: 2,
    inputLimit: 50_000,
    oversize: false,
    oversizeReasons: [],
  },
};

describe("isExcludedJob", () => {
  it("一致しなければ除外しない", () => {
    expect(isExcludedJob(base, ["bank.example"])).toBe(false);
  });

  it("保存用に短縮された URL からホスト名を読めなくても、保存済みのホスト名で除外する", () => {
    // 短縮された URL は別のホスト名として解釈される
    const truncated = `filesystem:https://${"u".repeat(100)}`;
    const job: ContentJob = {
      ...base,
      pageUrl: truncated,
      frameUrl: truncated,
      hostnames: ["news.example", "login.bank.example"],
      source: { ...base.source, displayUrl: truncated, providerUrl: "", hostname: "" },
    };
    expect(isExcludedJob(job, ["*.bank.example"])).toBe(true);
  });

  it("取得元のホスト名でも除外する", () => {
    const job: ContentJob = { ...base, source: { ...base.source, hostname: "bank.example" } };
    expect(isExcludedJob(job, ["bank.example"])).toBe(true);
  });

  it("保存済みの URL でも除外する", () => {
    expect(isExcludedJob({ ...base, frameUrl: "https://bank.example/" }, ["bank.example"])).toBe(
      true,
    );
  });
});

describe("needsConfirmation", () => {
  const oversized: ContentJob = { ...base, source: { ...base.source, oversize: true } };

  it("上限超過のジョブは設定に関わらず確認する", () => {
    expect(needsConfirmation(oversized, "never")).toBe(true);
    expect(needsConfirmation(oversized, "oversize")).toBe(true);
    expect(needsConfirmation(oversized, "always")).toBe(true);
  });

  it("上限内のジョブは「常に」のときだけ確認する", () => {
    expect(needsConfirmation(base, "always")).toBe(true);
    expect(needsConfirmation(base, "oversize")).toBe(false);
    expect(needsConfirmation(base, "never")).toBe(false);
  });
});
