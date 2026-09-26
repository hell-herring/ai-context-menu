import { useCallback, useEffect, useId, useRef, useState } from "react";
import { type MessageKey, t } from "../../lib/i18n";
import { PROVIDERS } from "../../lib/providers/registry";
import { defaultProviderAfterSave, resolveProvider } from "../../lib/providers/select";
import { PROVIDER_IDS, type ProviderId } from "../../lib/providers/types";
import { getApiKeys, maskApiKey } from "../../lib/storage/secrets";
import { getCoreSettings, updateCoreSettings } from "../../lib/storage/settings";
import { ApiKeySection } from "./ApiKeySection";
import { ExcludedDomainsSection } from "./ExcludedDomainsSection";

// 設定画面: API キー（プロバイダごと）・使用する AI・除外ドメイン。
// 接続テスト・モデル選択・出力言語・上限などは設定画面の PR で追加する。

type StoredKeys = Record<ProviderId, string | undefined>;

export function App() {
  const [keys, setKeys] = useState<StoredKeys | undefined>(undefined);
  const [preferred, setPreferred] = useState<ProviderId | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  /** キーの登録状況（保存・削除の処理順に更新する。描画時点の値ではなくこちらで既定プロバイダを判定する） */
  const registeredRef = useRef<Record<ProviderId, boolean> | undefined>(undefined);
  /** キーの保存・削除の後処理を 1 件ずつ行うキュー（複数のフォームを続けて保存しても判定が競合しない） */
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    Promise.all([getApiKeys(), getCoreSettings()])
      .then(([apiKeys, settings]) => {
        const stored: StoredKeys = {
          anthropic: apiKeys.anthropic && maskApiKey(apiKeys.anthropic),
          openai: apiKeys.openai && maskApiKey(apiKeys.openai),
        };
        registeredRef.current = registered(stored);
        setKeys(stored);
        setPreferred(settings.defaultProvider);
      })
      .catch(() => setLoadError(true));
  }, []);

  const onKeyChange = useCallback((provider: ProviderId, masked: string | undefined) => {
    const task = queueRef.current.then(async () => {
      const before = registeredRef.current;
      if (!before) {
        return;
      }
      registeredRef.current = { ...before, [provider]: masked !== undefined };
      setKeys((current) => current && { ...current, [provider]: masked });
      if (masked === undefined) {
        return;
      }
      // 最初にキーを登録したプロバイダを既定にする（docs/spec.md §3.6）。
      // 保存前に使われていたプロバイダは維持するため、保存前のキーと最新の設定で判定する
      const { defaultProvider } = await getCoreSettings();
      const changed = defaultProviderAfterSave(defaultProvider, provider, before);
      if (changed !== undefined) {
        await updateCoreSettings({ defaultProvider: changed });
        setPreferred(changed);
      }
    });
    // 1 件の失敗で後続の処理が止まらないようにする（失敗は呼び出し元のフォームで表示する）
    queueRef.current = task.catch(() => {});
    return task;
  }, []);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <h1 className="font-semibold text-xl">{t("optionsTitle")}</h1>

      <p className="text-neutral-700 text-sm dark:text-neutral-300">{t("optionsDataNote")}</p>

      {loadError && (
        <p role="alert" className="text-red-700 text-sm dark:text-red-400">
          {t("optionsLoadFailed")}
        </p>
      )}

      {keys && (
        <>
          <ProviderSection
            keys={keys}
            preferred={preferred}
            onSelect={async (provider) => {
              await updateCoreSettings({ defaultProvider: provider });
              setPreferred(provider);
            }}
          />
          {PROVIDER_IDS.map((provider) => (
            <ApiKeySection
              key={provider}
              provider={provider}
              stored={keys[provider]}
              onChange={(masked) => onKeyChange(provider, masked)}
            />
          ))}
        </>
      )}

      <ExcludedDomainsSection />
    </main>
  );
}

function registered(keys: StoredKeys): Record<ProviderId, boolean> {
  return { anthropic: keys.anthropic !== undefined, openai: keys.openai !== undefined };
}

/** 使用する AI（キーを登録したプロバイダから選ぶ） */
function ProviderSection({
  keys,
  preferred,
  onSelect,
}: {
  keys: StoredKeys;
  preferred: ProviderId | undefined;
  onSelect: (provider: ProviderId) => Promise<void>;
}) {
  const headingId = useId();
  const selectId = useId();
  const [notice, setNotice] = useState<{ key: MessageKey; error: boolean } | undefined>(undefined);
  const available = PROVIDER_IDS.filter((provider) => keys[provider] !== undefined);
  const current = resolveProvider(preferred, registered(keys));

  const select = async (provider: ProviderId) => {
    try {
      await onSelect(provider);
      setNotice({ key: "optionsSaved", error: false });
    } catch {
      setNotice({ key: "optionsSaveFailed", error: true });
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId}>
      <h2 id={headingId} className="font-semibold text-base">
        {t("optionsProviderHeading")}
      </h2>
      {current === undefined ? (
        <p className="text-neutral-600 text-sm dark:text-neutral-400">{t("optionsProviderNone")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={selectId} className="font-medium text-sm">
            {t("optionsProviderLabel")}
          </label>
          <select
            id={selectId}
            value={current}
            disabled={available.length < 2}
            onChange={(event) => {
              const provider = PROVIDER_IDS.find((id) => id === event.target.value);
              if (provider) {
                void select(provider);
              }
            }}
            className="rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-600"
          >
            {available.map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDERS[provider].displayName}
              </option>
            ))}
          </select>
        </div>
      )}
      <p
        role="status"
        aria-live="polite"
        className={`text-sm ${notice?.error ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}
      >
        {notice && t(notice.key)}
      </p>
    </section>
  );
}
