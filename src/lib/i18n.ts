import { browser } from "wxt/browser";
import type messages from "../public/_locales/ja/messages.json";

/** `_locales/ja/messages.json` のキー。存在しないキーの参照を型で防ぐ */
export type MessageKey = keyof typeof messages;

/** UI 文字列は必ずこの関数（chrome.i18n）経由で取得する */
export function t(key: MessageKey, substitutions?: string | string[]): string {
  return browser.i18n.getMessage(key, substitutions);
}
