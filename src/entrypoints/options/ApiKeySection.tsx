import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { type MessageKey, t } from "../../lib/i18n";
import { PROVIDER_ERROR_MESSAGES } from "../../lib/providers/error-messages";
import { PROVIDERS } from "../../lib/providers/registry";
import { ProviderError, type ProviderId } from "../../lib/providers/types";
import {
  getApiKey,
  maskApiKey,
  normalizeApiKey,
  removeApiKey,
  setApiKey,
} from "../../lib/storage/secrets";
import { type Notice, StatusMessage } from "./StatusMessage";
import { FIELD, HINT, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./styles";

const HEADINGS = {
  anthropic: "optionsAnthropicHeading",
  openai: "optionsOpenaiHeading",
} as const satisfies Record<ProviderId, MessageKey>;

/** 入力欄のプレースホルダ（キーの形式の目安。実キーではない） */
const PLACEHOLDERS: Record<ProviderId, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
};

/**
 * プロバイダ 1 つ分の設定。API キーの保存・削除・接続テストと、`children`（モデルの設定）を表示する。
 * キーは storage.local のみに置く（docs/guardrails.md §1）
 */
export function ApiKeySection({
  provider,
  stored,
  onChangeStart,
  onChange,
  children,
}: {
  provider: ProviderId;
  /** 保存済みのキー（マスク済み）。未設定なら undefined */
  stored: string | undefined;
  /** 保存・削除の後に呼ぶ。引数は新しいマスク済みのキー */
  onChange: (masked: string | undefined) => Promise<void>;
  /** 保存・削除を始める直前に呼ぶ（古いキーで取得したモデル一覧を、書き込みの途中から使わせないため） */
  onChangeStart: () => void;
  children?: ReactNode;
}) {
  const headingId = useId();
  const inputId = useId();
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  /**
   * 保存・削除・接続テストのいずれかを実行中。実行中は他の操作を受け付けない
   * （接続テストの途中でキーが差し替わり、古いキーの結果を新しいキーの結果として表示しないように）
   */
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  /** 操作を 1 つずつ実行する（ボタンの無効化に加え、Enter キーでの送信なども弾く） */
  const exclusive = async (operation: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await operation();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    return exclusive(async () => {
      const apiKey = normalizeApiKey(input);
      if (apiKey === undefined) {
        setNotice({ message: t("optionsInvalidKey"), tone: "error" });
        return;
      }
      try {
        onChangeStart();
        await setApiKey(provider, apiKey);
        setInput("");
        await onChange(maskApiKey(apiKey));
        setNotice({ message: t("optionsSaved"), tone: "success" });
      } catch {
        setNotice({ message: t("optionsSaveFailed"), tone: "error" });
      }
    });
  };

  const remove = () =>
    exclusive(async () => {
      try {
        onChangeStart();
        await removeApiKey(provider);
        await onChange(undefined);
        setNotice({ message: t("optionsDeleted"), tone: "success" });
      } catch {
        setNotice({ message: t("optionsSaveFailed"), tone: "error" });
      }
    });

  /** 接続テスト（Models API でキーを検証する。ユーザーの操作時のみ送信する） */
  const test = () =>
    exclusive(async () => {
      setNotice({ message: t("optionsTesting"), tone: "info" });
      try {
        const apiKey = await getApiKey(provider);
        if (apiKey === undefined) {
          setNotice({ message: t("errorApiKeyMissing"), tone: "error" });
          return;
        }
        await PROVIDERS[provider].verifyKey(apiKey);
        setNotice({ message: t("optionsConnectionOk"), tone: "success" });
      } catch (error) {
        const kind = error instanceof ProviderError ? error.kind : "unknown";
        setNotice({ message: t(PROVIDER_ERROR_MESSAGES[kind]), tone: "error" });
      }
    });

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId}>
      <h2 id={headingId} className="font-semibold text-base">
        {t(HEADINGS[provider])}
      </h2>
      <p className="text-neutral-600 text-sm dark:text-neutral-400">
        {stored ? t("optionsKeyStored", stored) : t("optionsKeyNotStored")}
      </p>
      <form className="flex flex-col gap-2" onSubmit={(event) => void save(event)}>
        <label htmlFor={inputId} className="font-medium text-sm">
          {t("optionsApiKeyLabel")}
        </label>
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={PLACEHOLDERS[provider]}
          className={`${FIELD} font-mono`}
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
            {t("optionsSave")}
          </button>
          {stored && (
            <>
              <button
                type="button"
                onClick={() => void test()}
                disabled={busy}
                className={SECONDARY_BUTTON}
              >
                {t("optionsTestConnection")}
              </button>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className={SECONDARY_BUTTON}
              >
                {t("optionsDelete")}
              </button>
            </>
          )}
        </div>
      </form>
      <p className={HINT}>{t("optionsStorageNote", PROVIDERS[provider].displayName)}</p>
      <StatusMessage notice={notice} />
      {children}
    </section>
  );
}
