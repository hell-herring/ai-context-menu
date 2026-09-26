import type { MessageKey } from "../i18n";
import type { ProviderErrorKind } from "./types";

/** プロバイダのエラー種別ごとの表示文言（docs/spec.md §3.7）。API キーやレスポンスの詳細は表示しない */
export const PROVIDER_ERROR_MESSAGES = {
  auth: "errorAuth",
  rate_limit: "errorRateLimit",
  overloaded: "errorOverloaded",
  network: "errorNetwork",
  bad_request: "errorBadRequest",
  aborted: "statusStopped",
  unknown: "errorUnknown",
} as const satisfies Record<ProviderErrorKind, MessageKey>;
