import { t } from "../../lib/i18n";

export function App() {
  return (
    <main className="flex min-h-screen flex-col gap-3 p-4">
      <h1 className="font-semibold text-base">{t("extName")}</h1>
      <p className="text-neutral-600 text-sm dark:text-neutral-400">{t("sidePanelEmpty")}</p>
    </main>
  );
}
