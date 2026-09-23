import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Page from "./page";
import { LocalReader } from "@/components/local-reader";

describe("Page 查询参数", () => {
  it("主页打开本地论文库与导入流程，不再固定展示示例论文", async () => {
    const page = await Page({ searchParams: Promise.resolve({}) });
    expect(page.type).toBe(LocalReader);
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", message: "后端连接正常" }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("直达 ?tab=proof 时首次渲染即显示证明正文", async () => {
    render(await Page({ searchParams: Promise.resolve({ tab: "proof" }) }));
    expect(screen.getByRole("tab", { name: "证明" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "证明" })).toBeVisible();
    expect(screen.getByRole("article", { name: "命题 4.1 的证明解读" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "命题陈述与符号说明" })).not.toBeInTheDocument();
    await screen.findByText("前后端已连接");
  });

  it.each([{ tab: "unknown" }, { tab: ["proof", "symbols"] }])("无效的旧链接 tab=$tab 回退概览", async ({ tab }) => {
    render(await Page({ searchParams: Promise.resolve({ tab }) }));
    expect(screen.getByRole("tab", { name: "概览" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "概览" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "命题陈述与符号说明" })).toBeVisible();
    await screen.findByText("前后端已连接");
  });

  it("旧 ?tab=symbols 链接回退概览，仍能读到完整符号解释", async () => {
    render(await Page({ searchParams: Promise.resolve({ tab: "symbols" }) }));
    expect(screen.getByRole("tab", { name: "概览" })).toHaveAttribute("aria-selected", "true");
    const overview = screen.getByRole("tabpanel", { name: "概览" });
    const symbols = screen.getByRole("region", { name: "公式中的符号" });
    expect(overview).toContainElement(symbols);
    expect(symbols).toBeVisible();
    expect(symbols.querySelectorAll(".symbol-row")).toHaveLength(15);
    expect(screen.queryByRole("tab", { name: "符号" })).not.toBeInTheDocument();
    await screen.findByText("前后端已连接");
  });

  it("直达 ?tab=relations 时显示关系正文而非图画布", async () => {
    const { container } = render(await Page({ searchParams: Promise.resolve({ tab: "relations" }) }));
    expect(screen.getByRole("tab", { name: "关系" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "它把两侧的差值，变成一个墙上积分" })).toBeVisible();
    expect(container.querySelectorAll(".relations-reading__explanation")).toHaveLength(8);
    expect(container.querySelector(".react-flow")).not.toBeInTheDocument();
    await screen.findByText("前后端已连接");
  });
});
