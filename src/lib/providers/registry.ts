import { createAnthropicProvider } from "./anthropic";
import type { Provider, ProviderId } from "./types";

export const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: createAnthropicProvider(),
};
