import { describe, expect, it } from "vitest";
import pkg from "../../package.json";

// 依存は lockfile と合わせて再現性を確保するため固定バージョンにする（docs/tech-stack.md §1）
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

describe("package.json", () => {
  it.each([
    ["dependencies", pkg.dependencies],
    ["devDependencies", pkg.devDependencies],
  ])("%s は ^ / ~ などの範囲指定を使わず固定バージョンで指定する", (_field, deps) => {
    const ranged = Object.entries(deps).filter(([, version]) => !EXACT_VERSION.test(version));
    expect(ranged).toEqual([]);
  });
});
