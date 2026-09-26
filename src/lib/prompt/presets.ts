import type { MessageKey } from "../i18n";

/** 組み込みプリセット（docs/spec.md §3.5）。指示文は M1 以降で追加する */
export const PRESET_IDS = ["summary", "tldr3", "bullets"] as const;

export type PresetId = (typeof PRESET_IDS)[number];

/** コンテキストメニューに表示するプリセット名の i18n キー */
export const PRESET_MENU_TITLE_KEYS = {
  summary: "menuSummary",
  tldr3: "menuTldr3",
  bullets: "menuBullets",
} as const satisfies Record<PresetId, MessageKey>;

export function isPresetId(value: string): value is PresetId {
  return (PRESET_IDS as readonly string[]).includes(value);
}
