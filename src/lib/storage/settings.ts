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

/** 設定の一部を更新する。検証してから保存する（容量超過は SyncQuotaError） */
export async function updateCoreSettings(
  patch: Partial<Omit<CoreSettings, "version">>,
): Promise<void> {
  const value = CoreSettingsSchema.parse({ ...(await getCoreSettings()), ...patch });
  await setSyncItem(CORE_SETTINGS_KEY, value);
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
