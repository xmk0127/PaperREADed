import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const appRequire = createRequire(import.meta.url);
const reactKatexRequire = createRequire(appRequire.resolve("react-katex"));

describe("KaTeX 渲染器与样式兼容性", () => {
  it("React 公式组件和全局样式必须来自同一个 KaTeX 安装实例", () => {
    // Separate versions can parse successfully yet break slash overlays and
    // script sizing because KaTeX's generated CSS class names change.
    expect(reactKatexRequire.resolve("katex")).toBe(appRequire.resolve("katex"));
    expect(reactKatexRequire.resolve("katex/dist/katex.min.css")).toBe(appRequire.resolve("katex/dist/katex.min.css"));
  });

  it("全局公式样式版本与实际渲染器版本一致", () => {
    const css = readFileSync(appRequire.resolve("katex/dist/katex.css"), "utf8");
    const renderer = reactKatexRequire("katex") as { version: string };
    const cssVersion = css.match(/\.katex-version::after\s*\{\s*content:\s*"([^"]+)"/)?.[1];
    expect(cssVersion).toBe(renderer.version);
  });
});
