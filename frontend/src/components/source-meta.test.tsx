import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaperPdfAvailabilityContext, SourceMeta } from "./source-meta";

const sourcePage = { pdf: [12, 12, 17], printed: [144, 149] };

describe("示例原文入口", () => {
  it("未附带 PDF 时保留来源页码并显示说明，不生成失效链接", () => {
    render(
      <PaperPdfAvailabilityContext.Provider value={false}>
        <SourceMeta sourcePage={sourcePage} inferred={false} />
      </PaperPdfAvailabilityContext.Provider>,
    );
    expect(screen.getByText(/PDF 第 12, 12, 17 页 · 论文第 144, 149 页/)).toBeVisible();
    expect(screen.getByText(/本机未附带示例 PDF/)).toBeVisible();
    expect(screen.getByText("原文明示")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("本机有 PDF 时保留逐页跳转、去重和新标签页行为", () => {
    render(
      <PaperPdfAvailabilityContext.Provider value={true}>
        <SourceMeta sourcePage={sourcePage} inferred compact />
      </PaperPdfAvailabilityContext.Provider>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const [index, page] of [12, 17].entries()) {
      expect(links[index]).toHaveAttribute("href", `/papers/wall-crossing-symplectic-vortices.pdf#page=${page}&zoom=page-fit`);
      expect(links[index]).toHaveAttribute("target", "_blank");
      expect(links[index]).toHaveAttribute("rel", "noreferrer");
    }
    expect(screen.getByText("推断")).toBeVisible();
    expect(screen.queryByText(/本机未附带/)).not.toBeInTheDocument();
  });

  it("没有 PDF 来源页码时不虚构来源按钮或缺失提示", () => {
    render(
      <PaperPdfAvailabilityContext.Provider value={false}>
        <SourceMeta sourcePage={{ pdf: [], printed: [144] }} inferred />
      </PaperPdfAvailabilityContext.Provider>,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/本机未附带/)).not.toBeInTheDocument();
    expect(screen.getByText(/论文第 144 页/)).toBeVisible();
  });
});
