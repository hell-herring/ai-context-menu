import { browser } from "wxt/browser";
import { z } from "zod";
import { normalizeDomainPattern } from "../domain/exclude";
import { DEFAULT_MODELS } from "../providers/defaults";
import { type CoreSettings, CoreSettingsSchema, ExcludedDomainsSchema } from "./schema";
import { setSyncItem } from "./sync-quota";

const CORE_SETTINGS_KEY = "settings.core";

const EXCLUDED_DOMAINS_KEY = "settings.excludedDomains";

export const DEFAULT_SETTINGS: CoreSettings = {
  version: 1,
  models: { ...DEFAULT_MODELS },
  modelLimits: {},
  confirmBeforeSend: "oversize",
  outputLanguage: "browser",
  maxInputChars: 50_000,
  maxOutputTokens: 8_000,
};

/** 設定を読む。未保存・不正な値の場合は既定値を返す */
export async function getCoreSettings(): Promise<CoreSettings> {
  const stored = await browser.storage.sync.get(CORE_SETTINGS_KEY);
  const parsed = CoreSettingsSchema.safeParse(stored[CORE_SETTINGS_KEY]);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export type CoreSettingsPatch = Partial<Omit<CoreSettings, "version">>;

/** 同じページ内の設定の書き込みを 1 件ずつ行うキュー（読み込み〜書き込みの間に他の更新が割り込まないように） */
let coreSettingsQueue: Promise<unknown> = Promise.resolve();

/**
 * 設定の一部を更新し、保存した値を返す。検証してから保存する（容量超過は SyncQuotaError）。
 * 現在の値から更新内容を決める場合は関数を渡す（最新の値で呼ばれる。例外を投げれば保存しない）。
 */
export function updateCoreSettings(
  patch: CoreSettingsPatch | ((current: CoreSettings) => CoreSettingsPatch),
): Promise<CoreSettings> {
  const task = coreSettingsQueue.then(async () => {
    const current = await getCoreSettings();
    const changes = typeof patch === "function" ? patch(current) : patch;
    const value = CoreSettingsSchema.parse({ ...current, ...changes });
    await setSyncItem(CORE_SETTINGS_KEY, value);
    return value;
  });
  // 1 件の失敗で後続の更新が止まらないようにする（失敗は呼び出し元に返す）
  coreSettingsQueue = task.catch(() => {});
  return task;
}

/** 読み出し時は壊れた値でも解釈できる項目を残す（除外が黙って無効になるのを避ける） */
const StoredDomainsSchema = z.object({ domains: z.array(z.unknown()) });

/** 除外ドメイン（正規化済みのパターン）を読む。未保存なら空 */
export async function getExcludedDomains(): Promise<string[]> {
  const stored = await browser.storage.sync.get(EXCLUDED_DOMAINS_KEY);
  const parsed = StoredDomainsSchema.safeParse(stored[EXCLUDED_DOMAINS_KEY]);
  if (!parsed.success) {
    return [];
  }
  return parsed.data.domains.flatMap((domain) => {
    const pattern = typeof domain === "string" ? normalizeDomainPattern(domain) : undefined;
    return pattern === undefined ? [] : [pattern];
  });
}

/**
 * 除外ドメインを保存する。件数（最大 200）・容量の上限を超える場合は保存せずに例外を投げる
 * （件数超過は ZodError、容量超過は SyncQuotaError）。
 */
export async function setExcludedDomains(domains: readonly string[]): Promise<void> {
  const value = ExcludedDomainsSchema.parse({ version: 1, domains });
  await setSyncItem(EXCLUDED_DOMAINS_KEY, value);
}

/** 設定（`settings.core`）の変更を監視する（他のページでの保存を反映するため）。解除関数を返す */
export function watchCoreSettings(onChange: () => void): () => void {
  const listener = (changes: Record<string, unknown>) => {
    if (CORE_SETTINGS_KEY in changes) {
      onChange();
    }
  };
  browser.storage.sync.onChanged.addListener(listener);
  return () => browser.storage.sync.onChanged.removeListener(listener);
}
