import { useCallback, useEffect, useState } from "react";
import {
  clearRecentSummaries,
  listRecentSummaries,
  watchRecentSummaries,
} from "../../lib/storage/recent";
import type { RecentSummary } from "../../lib/storage/schema";

/**
 * 最近の要約（storage.session。ブラウザ終了で消える）の一覧。
 * 他のウィンドウのサイドパネルでの保存・削除も反映する
 */
export function useRecent() {
  const [summaries, setSummaries] = useState<RecentSummary[]>([]);

  useEffect(() => {
    let disposed = false;
    let loads = 0;
    const load = async () => {
      const load = ++loads;
      try {
        const next = await listRecentSummaries();
        if (!disposed && load === loads) {
          setSummaries(next);
        }
      } catch (error) {
        console.error("Failed to load recent summaries", error);
      }
    };
    const unwatch = watchRecentSummaries(() => void load());
    void load();
    return () => {
      disposed = true;
      unwatch();
    };
  }, []);

  return {
    /** 新しい順 */
    summaries,
    clear: useCallback(() => {
      clearRecentSummaries().catch((error: unknown) => {
        console.error("Failed to clear recent summaries", error);
      });
    }, []),
  };
}
