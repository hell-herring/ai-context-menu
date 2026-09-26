import { describe, expect, it } from "vitest";
import type { Job } from "../storage/schema";
import { JOB_MAX_AGE_MS, JobReceiver } from "./receive";

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
