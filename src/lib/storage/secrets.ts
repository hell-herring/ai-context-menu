import { browser } from "wxt/browser";
import { z } from "zod";

// API キーは storage.local のみに置く（storage.sync に入れない。docs/guardrails.md §1）

export type SecretProvider = "anthropic";

const ApiKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^\S+$/, "API key must not contain whitespace");

function apiKeyStorageKey(provider: SecretProvider): string {
  return `secrets.${provider}.apiKey`;
}

/** 入力された API キーを検証して正規化する。不正なら undefined */
export function normalizeApiKey(input: string): string | undefined {
  const parsed = ApiKeySchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

export async function getApiKey(provider: SecretProvider): Promise<string | undefined> {
  const key = apiKeyStorageKey(provider);
  const stored = await browser.storage.local.get(key);
  const parsed = ApiKeySchema.safeParse(stored[key]);
  return parsed.success ? parsed.data : undefined;
}

export async function setApiKey(provider: SecretProvider, apiKey: string): Promise<void> {
  const normalized = ApiKeySchema.parse(apiKey);
  await browser.storage.local.set({ [apiKeyStorageKey(provider)]: normalized });
}

export async function removeApiKey(provider: SecretProvider): Promise<void> {
  await browser.storage.local.remove(apiKeyStorageKey(provider));
}

/** マスク表示用。末尾 4 文字だけを残す */
export function maskApiKey(apiKey: string): string {
  return `••••${apiKey.slice(-4)}`;
}
