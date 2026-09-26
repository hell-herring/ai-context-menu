import { isExcludedHostname, isExcludedPage, isExcludedUrl } from "../domain/exclude";
import type { ContentJob, Job } from "../storage/schema";

/** これより古いジョブは送信せず破棄する（取り残されたジョブの誤送信防止。docs/tech-stack.md §4.2） */
export const JOB_MAX_AGE_MS = 60_000;

export type JobDecision = "accept" | "duplicate" | "stale" | "expired";

/**
 * サイドパネルが受け取ったジョブを処理するかどうかを判定する。ジョブは 1 回だけ消費する。
 *
 * - 同じ ID のジョブは 2 回目以降を無視する（`onChanged` と起動時の `get` の両方で届く場合）
 * - 処理中/処理済みのジョブより前のクリックのジョブは無視する。
 *   Service Worker の再起動で `seq` がリセットされうるため、クリック時刻（`createdAt`）を先に比較する
 * - 作成から `JOB_MAX_AGE_MS` 以上経過したジョブは破棄する
 */
export class JobReceiver {
  readonly #processedIds = new Set<string>();
  #latest: Pick<Job, "seq" | "createdAt"> | undefined;

  decide(job: Job, now: number): JobDecision {
    if (this.#processedIds.has(job.id)) {
      return "duplicate";
    }
    this.#processedIds.add(job.id);

    if (this.#latest && isOlder(job, this.#latest)) {
      return "stale";
    }
    if (now - job.createdAt >= JOB_MAX_AGE_MS) {
      return "expired";
    }
    this.#latest = { seq: job.seq, createdAt: job.createdAt };
    return "accept";
  }
}

function isOlder(job: Pick<Job, "seq" | "createdAt">, latest: Pick<Job, "seq" | "createdAt">) {
  if (job.createdAt !== latest.createdAt) {
    return job.createdAt < latest.createdAt;
  }
  return job.seq < latest.seq;
}

/**
 * 送信直前の除外判定（docs/guardrails.md §2）。ジョブ作成時に切り詰める前の URL から求めたホスト名で判定し、
 * 念のため保存済みの URL（ページ・フレーム・表示用・送信用）でも判定する。
 */
export function isExcludedJob(job: ContentJob, patterns: readonly string[]): boolean {
  return (
    [...job.hostnames, job.source.hostname].some((hostname) =>
      isExcludedHostname(hostname, patterns),
    ) ||
    isExcludedPage(job, patterns) ||
    isExcludedUrl(job.source.displayUrl, patterns) ||
    isExcludedUrl(job.source.providerUrl, patterns)
  );
}
