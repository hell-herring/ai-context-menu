import { describe, expect, it } from "vitest";
import en from "../../src/public/_locales/en/messages.json";
import ja from "../../src/public/_locales/ja/messages.json";

const locales: Record<string, Record<string, { message: string }>> = { ja, en };

describe("_locales", () => {
  it("すべてのロケールが既定ロケール（ja）と同じキーを持つ", () => {
    const expected = Object.keys(ja).sort();
    for (const [locale, messages] of Object.entries(locales)) {
      expect(Object.keys(messages).sort(), locale).toEqual(expected);
    }
  });

  it("空のメッセージがない", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      for (const [key, { message }] of Object.entries(messages)) {
        expect(message.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });
});
