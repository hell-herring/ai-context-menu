import { useCallback, useEffect, useId, useRef, useState } from "react";
import { t } from "../../lib/i18n";
import { PROVIDERS } from "../../lib/providers/registry";
import { defaultProviderAfterSave, resolveProvider } from "../../lib/providers/select";
import { PROVIDER_IDS, type ProviderId } from "../../lib/providers/types";
import type { CoreSettings } from "../../lib/storage/schema";
import { getApiKeys, maskApiKey } from "../../lib/storage/secrets";
import {
  type CoreSettingsPatch,
  getCoreSettings,
  updateCoreSettings,
} from "../../lib/storage/settings";
import { ApiKeySection } from "./ApiKeySection";
import { ExcludedDomainsSection } from "./ExcludedDomainsSection";
import { GeneralSection } from "./GeneralSection";
import { ModelSection } from "./ModelSection";
import { type Notice, StatusMessage } from "./StatusMessage";
import { FIELD } from "./styles";

// 設定画面（docs/spec.md §3.6）: 使用する AI・プロバイダごとの API キー（接続テスト）とモデル・
// 要約の設定（出力言語・上限・送信前に確認）・除外ドメイン

type StoredKeys = Record<ProviderId, string | undefined>;

export function App() {
  const [keys, setKeys] = useState<StoredKeys | undefined>(undefined);
  const [settings, setSettings] = useState<CoreSettings | undefined>(undefined);
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
        setSettings(settings);
      })
      .catch(() => setLoadError(true));
  }, []);

  /** 設定を保存し、画面の値を保存後の値にする（書き込みは lib/storage/settings.ts で 1 件ずつ行う） */
  const saveSettings = useCallback(
    async (patch: CoreSettingsPatch | ((current: CoreSettings) => CoreSettingsPatch)) => {
      const saved = await updateCoreSettings(patch);
      setSettings(saved);
      return saved;
    },
    [],
  );

  const onKeyChange = useCallback(
    (provider: ProviderId, masked: string | undefined) => {
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
          await saveSettings({ defaultProvider: changed });
        }
      });
      // 1 件の失敗で後続の処理が止まらないようにする（失敗は呼び出し元のフォームで表示する）
      queueRef.current = task.catch(() => {});
      return task;
    },
    [saveSettings],
  );

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <h1 className="font-semibold text-xl">{t("optionsTitle")}</h1>

      <p className="text-neutral-700 text-sm dark:text-neutral-300">{t("optionsDataNote")}</p>

      {loadError && (
        <p role="alert" className="text-red-700 text-sm dark:text-red-400">
          {t("optionsLoadFailed")}
        </p>
      )}

      {keys && settings && (
        <>
          <ProviderSection
            keys={keys}
            preferred={settings.defaultProvider}
            onSelect={async (provider) => {
              await saveSettings({ defaultProvider: provider });
            }}
          />
          {PROVIDER_IDS.map((provider) => (
            <ApiKeySection
              key={provider}
              provider={provider}
              stored={keys[provider]}
              onChange={(masked) => onKeyChange(provider, masked)}
            >
              <ModelSection
                provider={provider}
                storedKey={keys[provider]}
                settings={settings}
                onSave={saveSettings}
              />
            </ApiKeySection>
          ))}
          <GeneralSection settings={settings} onSave={saveSettings} />
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
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const available = PROVIDER_IDS.filter((provider) => keys[provider] !== undefined);
  const current = resolveProvider(preferred, registered(keys));

  const select = async (provider: ProviderId) => {
    try {
      await onSelect(provider);
      setNotice({ message: t("optionsSaved"), tone: "success" });
    } catch {
      setNotice({ message: t("optionsSaveFailed"), tone: "error" });
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
            className={FIELD}
          >
            {available.map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDERS[provider].displayName}
              </option>
            ))}
          </select>
        </div>
      )}
      <StatusMessage notice={notice} />
    </section>
  );
}
