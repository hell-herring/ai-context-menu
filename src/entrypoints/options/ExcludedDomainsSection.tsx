import { type FormEvent, useEffect, useId, useState } from "react";
import { MAX_EXCLUDED_DOMAINS, parseDomainList } from "../../lib/domain/exclude";
import { t } from "../../lib/i18n";
import { getExcludedDomains, setExcludedDomains } from "../../lib/storage/settings";
import { SyncQuotaError } from "../../lib/storage/sync-quota";
import { type Notice, StatusMessage } from "./StatusMessage";
import { FIELD, PRIMARY_BUTTON } from "./styles";

/** エラー表示に含める不正な行の数と長さの上限 */
const MAX_INVALID_SHOWN = 5;
const MAX_INVALID_LENGTH = 80;

/** 除外ドメインの編集（docs/spec.md §3.6）。1 行に 1 パターン */
export function ExcludedDomainsSection() {
  const headingId = useId();
  const inputId = useId();
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  useEffect(() => {
    getExcludedDomains()
      .then((domains) => setInput(domains.join("\n")))
      .catch(() => setNotice({ message: t("optionsLoadFailed"), tone: "error" }));
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const { domains, invalid } = parseDomainList(input);
    if (invalid.length > 0) {
      const shown = invalid
        .slice(0, MAX_INVALID_SHOWN)
        .map((line) => line.slice(0, MAX_INVALID_LENGTH))
        .join(", ");
      setNotice({ message: t("optionsExcludedInvalid", shown), tone: "error" });
      return;
    }
    if (domains.length > MAX_EXCLUDED_DOMAINS) {
      setNotice({
        message: t("optionsExcludedTooMany", String(MAX_EXCLUDED_DOMAINS)),
        tone: "error",
      });
      return;
    }
    try {
      await setExcludedDomains(domains);
      setInput(domains.join("\n"));
      setNotice({ message: t("optionsSaved"), tone: "success" });
    } catch (error) {
      // 容量超過などの書き込み失敗は握りつぶさずに表示する
      const message =
        error instanceof SyncQuotaError
          ? t(error.reason === "item" ? "optionsSyncItemQuota" : "optionsSyncTotalQuota")
          : t("optionsSaveFailed");
      setNotice({ message, tone: "error" });
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
          className={`${FIELD} font-mono`}
        />
        <div className="flex gap-2">
          <button type="submit" className={PRIMARY_BUTTON}>
            {t("optionsSave")}
          </button>
        </div>
      </form>
      <StatusMessage notice={notice} />
    </section>
  );
}
