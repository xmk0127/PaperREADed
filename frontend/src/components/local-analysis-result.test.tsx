import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "@/types/local-analysis";
import { LocalAnalysisResult } from "./local-analysis-result";

const source = { pages: [2], evidence: "For every x, we have x² ≥ 0.", inferred: false };
const block = (text: string) => ({ kind: "paragraph" as const, text, source });
const result: AnalysisResult = {
  title: "命题 4.1", target_found: true,
  statement: [block("任意实数的平方非负。"), { kind: "formula", text: "x^2 \\geq 0", source }],
  symbols: [{ symbol: "x", meaning: "实数", explanation: "这里的 \\(x\\) 是任意实数。", source }],
  intuitive_explanation: [{ ...block("平方不会是负数。"), source: { ...source, inferred: true } }],
  proof: { goal: [block("证明非负性。")], strategy: [block("按符号分类。")], sections: [{ title: "分别讨论正负", blocks: [block("使用有序域的性质。")]}] },
  relations: [{ target: "定理 3.1", statement: [block("定理 3.1 的完整陈述。")], explanation: [block("本命题为该定理提供非负性。")]}],
  importance: [{ title: "它化简了什么", blocks: [block("不再需要单独检验非负性。")]}],
  limitations: [],
};

describe("LocalAnalysisResult", () => {
  it("陈述后紧接符号，KaTeX 渲染公式，来源默认折叠且有可核对链接", async () => {
    const user = userEvent.setup();
    const { container } = render(<LocalAnalysisResult result={result} paperId="paper-1" />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["概览", "证明", "关系", "为什么重要"]);
    const statement = screen.getByRole("region", { name: "结论陈述" });
    const symbols = screen.getByRole("region", { name: "公式中的符号" });
    expect(statement.nextElementSibling).toBe(symbols);
    expect(statement.querySelector(".katex-display")).toBeVisible();
    const details = statement.querySelector("details")!;
    expect(details).not.toHaveAttribute("open");
    await user.click(details.querySelector("summary")!);
    expect(within(details).getByText(source.evidence)).toBeVisible();
    expect(within(details).getByRole("link")).toHaveAttribute("href", "/api/local/papers/paper-1/pdf#page=2");
    expect(within(details).getByRole("link")).toHaveAttribute("target", "_blank");
    expect(screen.getByText("解读 / 推断")).toBeVisible();
    expect(container.querySelector(".react-flow")).toBeNull();
  });

  it("关系直接显示相关定理陈述，键盘可以切换标签", async () => {
    const user = userEvent.setup();
    render(<LocalAnalysisResult result={result} paperId="paper-1" />);
    await user.click(screen.getByRole("tab", { name: "关系" }));
    expect(screen.getByText("定理 3.1 的完整陈述。")).toBeVisible();
    expect(screen.getByText("本命题为该定理提供非负性。")).toBeVisible();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "为什么重要" })).toHaveFocus();
    expect(screen.getByText("不再需要单独检验非负性。")).toBeVisible();
    await user.keyboard("{Home}{ArrowRight}");
    expect(screen.getByText("使用有序域的性质。")).toBeVisible();
  });

  it("未找到指定结论时明确说明，不把模型输出当 HTML 执行", () => {
    const { container } = render(<LocalAnalysisResult result={{ ...result, target_found: false, limitations: ["文本不完整"], statement: [block('<img src=x onerror="alert(1)">')] }} paperId="paper-1" />);
    expect(screen.getByRole("alert")).toHaveTextContent("未找到你指定的结论");
    expect(screen.getByText("文本不完整")).toBeVisible();
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
  });
});
