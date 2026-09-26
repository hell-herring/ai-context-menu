import { describe, expect, it } from "vitest";
import { escapeXmlText } from "./escape";
import { estimatePromptTokens, inputTokenBudget, truncateEscapedToTokens } from "./fit";
import { estimateTokens } from "./tokens";

describe("estimatePromptTokens / inputTokenBudget", () => {
  it("system と user を別々に概算して足す", () => {
    expect(estimatePromptTokens({ system: "abcd", userContent: "日本" })).toBe(2 + 2);
  });

  it("入力上限から出力トークン分を差し引く", () => {
    expect(inputTokenBudget(200_000, 8_000)).toBe(192_000);
  });
});

describe("truncateEscapedToTokens", () => {
  it.each([
    ["abcdef", 1, "abc"],
    ["abcdef", 2, "abcdef"],
    ["日本語abc", 2, "日本"],
    ["日本語abc", 4, "日本語abc"],
    // `&` はエスケープで `&amp;`（5 文字）になる
    ["a&b", 1, "a"],
    ["a&b", 2, "a&"],
    ["abc", 0, ""],
  ])("%j を %i トークン以内 → %j", (content, maxTokens, expected) => {
    expect(truncateEscapedToTokens(content, maxTokens)).toBe(expected);
  });

  it("サロゲートペアの途中では切らない", () => {
    expect(truncateEscapedToTokens("😀😀😀😀", 1)).toBe("😀😀😀");
  });

  it("結果のエスケープ後の概算は上限以下で、1 文字足すと超える", () => {
    const content = "本文 <tag> & text ".repeat(50);
    for (const maxTokens of [1, 7, 30, 100]) {
      const fitted = truncateEscapedToTokens(content, maxTokens);
      expect(estimateTokens(escapeXmlText(fitted))).toBeLessThanOrEqual(maxTokens);
      const next = content.slice(0, fitted.length + 1);
      expect(estimateTokens(escapeXmlText(next))).toBeGreaterThan(maxTokens);
    }
  });
});
