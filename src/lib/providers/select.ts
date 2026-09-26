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
 * キーを保存した後に設定へ書き込む既定プロバイダ（「最初にキー登録したもの」。docs/spec.md §3.6）。
 *
 * 保存前に使われていたプロバイダ（`keysBefore` で解決したもの）があればそれを維持し、
 * なければ保存したプロバイダを既定にする。既定が未保存の設定（M1 で Anthropic のキーだけを登録済み等）
 * に 2 つ目のキーを追加しても、使うプロバイダが黙って切り替わらないよう、維持するプロバイダも書き込む。
 * 書き込み不要（設定の値のまま）なら undefined。
 */
export function defaultProviderAfterSave(
  current: ProviderId | undefined,
  saved: ProviderId,
  keysBefore: RegisteredKeys,
): ProviderId | undefined {
  const next = resolveProvider(current, keysBefore) ?? saved;
  return next === current ? undefined : next;
}
