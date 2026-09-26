import { DEFAULT_MODELS } from "../providers/defaults";
import { type RegisteredKeys, resolveProvider } from "../providers/select";
import { PROVIDER_IDS, type ProviderId } from "../providers/types";
import type { CoreSettings } from "../storage/schema";

// 送信先（プロバイダ・モデル）の決定。サイドパネルでの切り替え（docs/spec.md §3.4）は
// そのジョブだけに効かせ、設定には保存しない

/** 送信先のプロバイダとモデル */
export interface Target {
  provider: ProviderId;
  model: string;
}

/** サイドパネルで選べるモデル（設定で保存したモデルと既定モデル。Models API は呼ばない） */
export function modelChoices(
  settings: Pick<CoreSettings, "models">,
  provider: ProviderId,
): string[] {
  return [...new Set([settings.models[provider], DEFAULT_MODELS[provider]])];
}

/** サイドパネルで選べるプロバイダ（キーのあるもの。選択中のものはキーが削除されていても残す） */
export function providerChoices(
  keys: RegisteredKeys,
  selected: ProviderId | undefined,
): ProviderId[] {
  return PROVIDER_IDS.filter((id) => keys[id] || id === selected);
}

/**
 * 送信先を決める。サイドパネルで選んだものがあればそれ（キーが削除されていれば、
 * 他のプロバイダに黙って送らないよう undefined）、なければ設定の既定
 * （設定のプロバイダにキーがなければキーのある最初のもの）
 */
export function resolveTarget(
  settings: Pick<CoreSettings, "defaultProvider" | "models">,
  keys: RegisteredKeys,
  choice: Target | undefined,
): Target | undefined {
  if (choice) {
    return keys[choice.provider] ? choice : undefined;
  }
  const provider = resolveProvider(settings.defaultProvider, keys);
  return provider && { provider, model: settings.models[provider] };
}

/**
 * 送信先を反映した設定（リクエストの判定に使う。保存はしない）。
 * モデルの上限は記録したモデルと一致するときだけ使われる（lib/providers/limits.ts）ため、
 * 保存済みと違うモデルを選んだ場合は上限が分からない扱いになる
 */
export function settingsFor(settings: CoreSettings, target: Target): CoreSettings {
  return {
    ...settings,
    defaultProvider: target.provider,
    models: { ...settings.models, [target.provider]: target.model },
  };
}

/** プロバイダを切り替えたときに選ぶモデル（そのプロバイダの保存済みのモデル） */
export function targetForProvider(
  settings: Pick<CoreSettings, "models">,
  provider: ProviderId,
): Target {
  return { provider, model: settings.models[provider] };
}
