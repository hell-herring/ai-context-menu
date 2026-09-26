import { createAnthropicProvider } from "./anthropic";
import { createOpenAIProvider } from "./openai";
import type { Provider, ProviderId } from "./types";

export const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: createAnthropicProvider(),
  openai: createOpenAIProvider(),
};

/**
 * 画面の描画前に呼ぶ。E2E 用ビルド（`--mode e2e`）ではモックプロバイダに差し替える。
 * 本番ビルドでは条件が定数になり、分岐ごと（テスト専用コードの読み込みも）除去される
 */
export async function prepareProviders(): Promise<void> {
  if (import.meta.env.MODE === "e2e") {
    const { installMockProviders } = await import("../../testing/mock-provider");
    installMockProviders();
  }
}
