import { browser } from "wxt/browser";
import { type CoreSettings, CoreSettingsSchema } from "./schema";

const CORE_SETTINGS_KEY = "settings.core";

/** Anthropic の既定モデル（docs/tech-stack.md §4.5） */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

export const DEFAULT_SETTINGS: CoreSettings = {
  version: 1,
  models: { anthropic: DEFAULT_ANTHROPIC_MODEL },
  outputLanguage: "browser",
  maxInputChars: 50_000,
  maxOutputTokens: 8_000,
};

/**
 * 設定を読む。未保存・不正な値の場合は既定値を返す。
 * 設定画面（書き込み）は M2 で実装する。
 */
export async function getCoreSettings(): Promise<CoreSettings> {
  const stored = await browser.storage.sync.get(CORE_SETTINGS_KEY);
  const parsed = CoreSettingsSchema.safeParse(stored[CORE_SETTINGS_KEY]);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}
