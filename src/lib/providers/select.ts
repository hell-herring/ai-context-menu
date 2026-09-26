import { PROVIDER_IDS, type ProviderId } from "./types";

export type RegisteredKeys = Readonly<Record<ProviderId, boolean>>;

/**
 * 使用するプロバイダを決める。設定のプロバイダにキーがあればそれ、なければキーのある最初のプロバイダ。
 * どれにもキーがなければ undefined。
 */
export function resolveProvider(
  preferred: ProviderId | undefined,
  keys: RegisteredKeys,
): ProviderId | undefined {
  if (preferred !== undefined && keys[preferred]) {
    return preferred;
  }
  return PROVIDER_IDS.find((id) => keys[id]);
}

/**
 * キーを保存した後の既定プロバイダ。既定が未設定か、既定のプロバイダにキーがなければ
 * 保存したプロバイダを既定にする（「最初にキー登録したもの」。docs/spec.md §3.6）。
 * 変更不要なら undefined。
 */
export function defaultProviderAfterSave(
  current: ProviderId | undefined,
  saved: ProviderId,
  keys: RegisteredKeys,
): ProviderId | undefined {
  if (current !== undefined && current !== saved && keys[current]) {
    return undefined;
  }
  return current === saved ? undefined : saved;
}
