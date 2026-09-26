import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import { t } from "../../lib/i18n";
import { prepareProviders } from "../../lib/providers/registry";
import { App } from "./App";
import "../../styles/app.css";

document.documentElement.lang = browser.i18n.getUILanguage();
document.title = t("extName");

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

void prepareProviders().then(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
