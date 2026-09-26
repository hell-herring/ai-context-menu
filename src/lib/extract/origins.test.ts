import { describe, expect, it } from "vitest";
import { collectOrigins, MAX_ANCESTOR_ORIGINS } from "./origins";
import { FrameOriginsSchema } from "./schema";

function fakeWindow(origin: string, ancestors?: string[]) {
  return {
    origin,
    location: { ancestorOrigins: ancestors as unknown as DOMStringList | undefined },
  } as Parameters<typeof collectOrigins>[0];
}

describe("collectOrigins", () => {
  it("実際のオリジンと祖先オリジンを返す", () => {
    const origins = collectOrigins(
      fakeWindow("https://login.bank.example", [
        "https://login.bank.example",
        "https://news.example",
      ]),
    );
    expect(origins).toEqual([
      "https://login.bank.example",
      "https://login.bank.example",
      "https://news.example",
    ]);
    expect(FrameOriginsSchema.parse(origins)).toEqual(origins);
  });

  it("ancestorOrigins がなければ実際のオリジンのみ", () => {
    expect(collectOrigins(fakeWindow("null"))).toEqual(["null"]);
  });

  it("祖先オリジンは上限までに制限する", () => {
    const ancestors = Array.from({ length: 50 }, (_, i) => `https://a${i}.example`);
    const origins = collectOrigins(fakeWindow("https://x.example", ancestors));
    expect(origins).toHaveLength(MAX_ANCESTOR_ORIGINS + 1);
    expect(FrameOriginsSchema.safeParse(origins).success).toBe(true);
  });
});
