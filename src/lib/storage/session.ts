import { browser } from "wxt/browser";
import { createErrorJob, jobByteSize, MAX_JOB_BYTES } from "../job/create";
import { clearRecentSummaries, parseRecentSummaries, recentStorageKey } from "./recent";
import { type Job, JobSchema } from "./schema";

// 要約ジョブの受け渡し（storage.session。メモリのみ・ブラウザ終了で消える）。docs/tech-stack.md §4.2

export function jobStorageKey(windowId: number): string {
  return `job.${windowId}`;
}

export type WriteResult = "written" | "superseded" | "failed";

/** storage.session 全体で使ってよいバイト数（全体上限 10 MB に余裕を持たせる。docs/tech-stack.md §4.2 手順 8） */
export const MAX_SESSION_BYTES = 8 * 1024 * 1024;

/** 容量不足のときに削除できる最近の要約 */
export interface RecentUsage {
  key: string;
  bytes: number;
  createdAt: number;
}

/**
 * ジョブを書き込めるかの判定。使用量 − 置き換える既存ジョブ ＋ 新しいジョブが上限を超える場合は、
 * 最近の要約を古いものから削除して収める。すべて削除しても収まらなければ何も削除せずに `fits: false`
 */
export function planSessionCapacity(usage: {
  used: number;
  replaced: number;
  incoming: number;
  recents: readonly RecentUsage[];
  limit?: number;
}): { fits: boolean; remove: string[] } {
  const { replaced, incoming, recents, limit = MAX_SESSION_BYTES } = usage;
  let used = usage.used - replaced + incoming;
  const remove: string[] = [];
  for (const recent of [...recents].sort((a, b) => a.createdAt - b.createdAt)) {
    if (used <= limit) {
      break;
    }
    used -= recent.bytes;
    remove.push(recent.key);
  }
  return used <= limit ? { fits: true, remove } : { fits: false, remove: [] };
}

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
    let payload = jobByteSize(job) > MAX_JOB_BYTES ? createErrorJob(job, "tooLarge") : job;
    try {
      if (!(await makeRoom(key, payload))) {
        payload = createErrorJob(job, "tooManyJobs");
      }
    } catch {
      // 使用量を測れなくても書き込みは試みる（失敗したら下で最近の要約を削除して再試行する）
    }
    try {
      await browser.storage.session.set({ [key]: payload });
      return "written";
    } catch {
      // 容量超過など。最近の要約を削除して 1 回だけ再試行する
    }
    try {
      await clearRecentSummaries();
      await browser.storage.session.set({ [key]: payload });
      return "written";
    } catch {
      // それでも失敗したら小さなエラージョブで知らせる（それも失敗したら諦める）
    }
    try {
      await browser.storage.session.set({ [key]: createErrorJob(job, "tooLarge") });
    } catch {
      return "failed";
    }
    return "written";
  }
}

/**
 * storage.session 全体の容量を確認し、足りなければ最近の要約を古いものから削除する。
 * 削除しても収まらなければ false
 */
async function makeRoom(key: string, job: Job): Promise<boolean> {
  const incoming = byteSize(key, job);
  const [used, replaced] = await Promise.all([bytesInUse(null), bytesInUse([key])]);
  if (used - replaced + incoming <= MAX_SESSION_BYTES) {
    return true;
  }
  const recents = parseRecentSummaries(await browser.storage.session.get(null)).map((summary) => {
    const recentKey = recentStorageKey(summary.id);
    return { key: recentKey, bytes: byteSize(recentKey, summary), createdAt: summary.createdAt };
  });
  const plan = planSessionCapacity({ used, replaced, incoming, recents });
  if (plan.remove.length > 0) {
    await browser.storage.session.remove(plan.remove);
  }
  return plan.fits;
}

/** キーと値を JSON 化した UTF-8 バイト数（getBytesInUse と同じ数え方の近似） */
function byteSize(key: string, value: unknown): number {
  return new TextEncoder().encode(key + JSON.stringify(value)).length;
}

/** storage.session の使用バイト数。getBytesInUse が使えなければ値から概算する */
async function bytesInUse(keys: string[] | null): Promise<number> {
  try {
    return await browser.storage.session.getBytesInUse(keys);
  } catch {
    const items = await browser.storage.session.get(keys);
    return Object.entries(items).reduce((sum, [key, value]) => sum + byteSize(key, value), 0);
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
