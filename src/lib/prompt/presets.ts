import type { MessageKey } from "../i18n";

/** 組み込みプリセット（docs/spec.md §3.5） */
export const PRESET_IDS = ["summary", "tldr3", "bullets"] as const;

export type PresetId = (typeof PRESET_IDS)[number];

/** コンテキストメニューに表示するプリセット名の i18n キー */
export const PRESET_MENU_TITLE_KEYS = {
  summary: "menuSummary",
  tldr3: "menuTldr3",
  bullets: "menuBullets",
} as const satisfies Record<PresetId, MessageKey>;

/** プロンプトの末尾に付ける指示文（UI の言語ではなくプロンプトの一部なので i18n しない） */
export const PRESET_INSTRUCTIONS = {
  summary:
    "上記の文書の主旨と重要な論点を簡潔にまとめてください。短い見出しと箇条書きを使ってください。",
  tldr3: "上記の文書を3行以内で要約してください。",
  bullets: "上記の文書の重要なポイントを5〜10個の箇条書きで挙げてください。",
} as const satisfies Record<PresetId, string>;

export function isPresetId(value: string): value is PresetId {
  return (PRESET_IDS as readonly string[]).includes(value);
}
