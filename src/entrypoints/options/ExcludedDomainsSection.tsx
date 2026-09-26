import { type FormEvent, useEffect, useId, useState } from "react";
import { MAX_EXCLUDED_DOMAINS, parseDomainList } from "../../lib/domain/exclude";
import { t } from "../../lib/i18n";
import { getExcludedDomains, setExcludedDomains } from "../../lib/storage/settings";
import { SyncQuotaError } from "../../lib/storage/sync-quota";

/** エラー表示に含める不正な行の数と長さの上限 */
const MAX_INVALID_SHOWN = 5;
const MAX_INVALID_LENGTH = 80;

type Notice = { message: string; error: boolean };

/** 除外ドメインの編集（docs/spec.md §3.6）。1 行に 1 パターン */
export function ExcludedDomainsSection() {
  const headingId = useId();
  const inputId = useId();
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  useEffect(() => {
    getExcludedDomains()
      .then((domains) => setInput(domains.join("\n")))
      .catch(() => setNotice({ message: t("optionsLoadFailed"), error: true }));
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const { domains, invalid } = parseDomainList(input);
    if (invalid.length > 0) {
      const shown = invalid
        .slice(0, MAX_INVALID_SHOWN)
        .map((line) => line.slice(0, MAX_INVALID_LENGTH))
        .join(", ");
      setNotice({ message: t("optionsExcludedInvalid", shown), error: true });
      return;
    }
    if (domains.length > MAX_EXCLUDED_DOMAINS) {
      setNotice({
        message: t("optionsExcludedTooMany", String(MAX_EXCLUDED_DOMAINS)),
        error: true,
      });
      return;
    }
    try {
      await setExcludedDomains(domains);
      setInput(domains.join("\n"));
      setNotice({ message: t("optionsSaved"), error: false });
    } catch (error) {
      // 容量超過などの書き込み失敗は握りつぶさずに表示する
      const message =
        error instanceof SyncQuotaError
          ? t(error.reason === "item" ? "optionsSyncItemQuota" : "optionsSyncTotalQuota")
          : t("optionsSaveFailed");
      setNotice({ message, error: true });
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId}>
      <h2 id={headingId} className="font-semibold text-base">
        {t("optionsExcludedHeading")}
      </h2>
      <p className="text-neutral-600 text-sm dark:text-neutral-400">
        {t("optionsExcludedDescription", String(MAX_EXCLUDED_DOMAINS))}
      </p>
      <form className="flex flex-col gap-2" onSubmit={(event) => void save(event)}>
        <label htmlFor={inputId} className="font-medium text-sm">
          {t("optionsExcludedLabel")}
        </label>
        <textarea
          id={inputId}
          rows={6}
          spellCheck={false}
          autoComplete="off"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t("optionsExcludedPlaceholder")}
          className="rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 font-mono text-sm dark:border-neutral-600"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            {t("optionsSave")}
          </button>
        </div>
      </form>
      <p
        role="status"
        aria-live="polite"
        className={`text-sm ${notice?.error ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}
      >
        {notice?.message}
      </p>
    </section>
  );
}
