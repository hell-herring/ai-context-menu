import { browser } from "wxt/browser";
import { createErrorJob, jobByteSize, MAX_JOB_BYTES } from "../job/create";
import { type Job, JobSchema } from "./schema";

// 要約ジョブの受け渡し（storage.session。メモリのみ・ブラウザ終了で消える）。docs/tech-stack.md §4.2

export function jobStorageKey(windowId: number): string {
  return `job.${windowId}`;
}

export type WriteResult = "written" | "superseded" | "failed";

/**
 * background 側のジョブ書き込み。
 *
 * - クリック受付時に `nextSeq()` でウィンドウごとの連番を採番し、書き込み時点で最新でなければ破棄する
 *   （抽出の完了順が前後しても、古いクリックが新しいジョブを上書きしない）
 * - `job.<windowId>` への書き込みはすべて `write()` を通し、単一の直列キューで 1 件ずつ行う
 */
export class JobWriter {
  readonly #latestSeq = new Map<number, number>();
  #queue: Promise<unknown> = Promise.resolve();

  nextSeq(windowId: number): number {
    const seq = (this.#latestSeq.get(windowId) ?? 0) + 1;
    this.#latestSeq.set(windowId, seq);
    return seq;
  }

  write(job: Job): Promise<WriteResult> {
    const task = this.#queue.then(() => this.#write(job));
    // 1 件の失敗で後続の書き込みが止まらないようにする
    this.#queue = task.catch(() => {});
    return task;
  }

  async #write(job: Job): Promise<WriteResult> {
    if (this.#latestSeq.get(job.windowId) !== job.seq) {
      return "superseded";
    }
    const key = jobStorageKey(job.windowId);
    const payload = jobByteSize(job) > MAX_JOB_BYTES ? createErrorJob(job, "tooLarge") : job;
    try {
      await browser.storage.session.set({ [key]: payload });
      return "written";
    } catch {
      // 容量超過など。小さなエラージョブで知らせる（それも失敗したら諦める）
      try {
        await browser.storage.session.set({ [key]: createErrorJob(job, "tooLarge") });
      } catch {
        return "failed";
      }
      return "written";
    }
  }
}

/** サイドパネル側: 自分のウィンドウのジョブを読む。不正な値は無視する */
export async function readJob(windowId: number): Promise<Job | undefined> {
  const key = jobStorageKey(windowId);
  const stored = await browser.storage.session.get(key);
  return parseJob(stored[key]);
}

/** サイドパネル側: ジョブを消費する（プロバイダ呼び出しの前に必ず削除する） */
export async function removeJob(windowId: number): Promise<void> {
  await browser.storage.session.remove(jobStorageKey(windowId));
}

/** サイドパネル側: 自分のウィンドウのジョブの書き込みを監視する。解除関数を返す */
export function watchJob(windowId: number, onJob: (job: Job) => void): () => void {
  const key = jobStorageKey(windowId);
  const listener = (changes: Record<string, { newValue?: unknown }>) => {
    const job = parseJob(changes[key]?.newValue);
    if (job) {
      onJob(job);
    }
  };
  browser.storage.session.onChanged.addListener(listener);
  return () => browser.storage.session.onChanged.removeListener(listener);
}

function parseJob(value: unknown): Job | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = JobSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
