import { describe, expect, it } from "vitest";
import { estimateTokens } from "./tokens";

describe("estimateTokens", () => {
  it.each([
    ["", 0],
    ["abc", 1],
    ["abcd", 2],
    ["日本語", 3],
    ["ひらがなカタカナ한글", 10],
    ["日本 abc", 4],
  ])("%j → %i", (text, expected) => {
    expect(estimateTokens(text)).toBe(expected);
  });
});
