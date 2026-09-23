import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { propositionData } from "@/lib/proposition-data";

import { RelationsReading } from "./relations-reading";

describe("相关结论陈述", () => {
  it("默认展开关系推导，并可查看定理 3.1 的条件、跨墙等式和 alpha_0 的完整公式", async () => {
    const user = userEvent.setup();
    const { container } = render(<RelationsReading data={propositionData} />);
    const statement = container.querySelector("#related-statement-main_consequence")!;
    const interpretation = container.querySelector("#interpretation-main_consequence")!;
    expect(interpretation).toBeVisible();
    expect(statement).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: "定理 3.1（跨墙公式）" }));
    expect(statement).toBeVisible();
    expect(statement).toHaveTextContent("对所有充分小的");
    expect(statement).toHaveTextContent("全部极点");
    expect(statement).toHaveTextContent("欧拉类求值");
    expect(statement.querySelectorAll(".katex-display")).toHaveLength(2);
    for (const formula of statement.querySelectorAll(".katex-display")) expect(formula).toBeVisible();
    const statementSource = statement.querySelector(":scope > .source-meta") as HTMLElement;
    expect(within(statementSource).getByRole("link", { name: "在论文中查看，PDF 第 10 页（在新标签页打开）" })).toHaveAttribute(
      "href", "/papers/wall-crossing-symplectic-vortices.pdf#page=10&zoom=page-fit",
    );
    expect(within(statementSource).getByRole("link", { name: "在论文中查看，PDF 第 11 页（在新标签页打开）" })).toBeVisible();
    expect(container.querySelector(".katex-error, .math-text__fallback, .react-flow")).not.toBeInTheDocument();
  });

  it("点击结论名称即可展开实际陈述，展开和收起不影响关系说明", async () => {
    const user = userEvent.setup();
    const { container } = render(<RelationsReading data={propositionData} />);
    for (const relation of propositionData.relations) {
      const statement = container.querySelector(`#related-statement-${relation.relation}`)!;
      const row = statement.closest("section")!;
      const explanation = row.querySelector(".relations-reading__explanation")!;
      const button = screen.getByRole("button", { name: relation.target });
      expect(statement).not.toBeVisible();
      expect(button).toHaveAttribute("aria-expanded", "false");
      await user.click(button);
      expect(statement).toBeVisible();
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(button).toHaveAttribute("aria-controls", statement.id);
      const expected = propositionData.related_statements[relation.relation];
      expect(statement).toHaveTextContent(expected.scope);
      expect(statement.querySelectorAll(".katex-display")).toHaveLength(expected.blocks.filter((block) => block.type === "formula").length);
      for (const formula of statement.querySelectorAll(".katex-display")) expect(formula).toBeVisible();
      await user.click(screen.getByRole("button", { name: `${relation.target}：收起结论与公式` }));
      expect(statement).not.toBeVisible();
      expect(explanation).toBeVisible();
    }
  });

  it("可以展开必要定义和墙条件，并从这些定义定位原文", async () => {
    const user = userEvent.setup();
    const { container } = render(<RelationsReading data={propositionData} />);
    const statement = container.querySelector("#related-statement-main_consequence")!;
    await user.click(screen.getByRole("button", { name: "定理 3.1（跨墙公式）" }));
    const context = statement.querySelector(".related-statement__context")!;
    expect(context.querySelector("dl")).not.toBeVisible();
    await user.click(context.querySelector("summary")!);
    expect(context.querySelector("dl")).toBeVisible();
    expect(within(context as HTMLElement).getByText("跨过哪一面墙")).toBeVisible();
    expect(within(context as HTMLElement).getByText("指数中的 Ων")).toBeVisible();
    for (const link of context.querySelectorAll("a")) {
      expect(link).toBeVisible();
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
    expect(statement.querySelector(".katex-error, .math-text__fallback")).not.toBeInTheDocument();
  });

  it("全部八条关系的因果解读与推导公式都直接展开，陈述开关不会隐藏解释", async () => {
    const user = userEvent.setup();
    const { container } = render(<RelationsReading data={propositionData} />);
    const interpretations = container.querySelectorAll(".relation-interpretation");
    expect(interpretations).toHaveLength(8);
    for (const relation of propositionData.relations) {
      const analysis = propositionData.relation_analysis[relation.relation];
      const interpretation = container.querySelector(`#interpretation-${relation.relation}`)!.parentElement!;
      expect(interpretation).toBeVisible();
      expect(interpretation.closest("details, [hidden]")).toBeNull();
      const sections = interpretation.querySelectorAll(".relation-interpretation__section");
      expect(sections).toHaveLength(analysis.sections.length);
      analysis.sections.forEach((section, sectionIndex) => {
        const rendered = sections[sectionIndex];
        const blocks = Array.from(rendered.children).filter((child) => ["P", "FIGURE"].includes(child.tagName));
        expect(blocks).toHaveLength(section.blocks.length);
        section.blocks.forEach((block, blockIndex) => {
          expect(blocks[blockIndex]).toBeVisible();
          expect(blocks[blockIndex].tagName).toBe(block.type === "formula" ? "FIGURE" : "P");
          if (block.type === "formula") {
            expect(blocks[blockIndex].querySelector("annotation")).toHaveTextContent(block.latex.replace(/\s+/g, " "));
          }
        });
        expect(rendered.querySelector("summary .evidence-badge")).toHaveTextContent("推断");
        expect(rendered.querySelector("summary")).toHaveTextContent(`PDF 第 ${section.source_page.pdf.join(", ")} 页`);
      });
    }
    await user.click(screen.getByRole("button", { name: "定理 3.1（跨墙公式）" }));
    await user.click(screen.getByRole("button", { name: "定理 3.1（跨墙公式）：收起结论与公式" }));
    expect(container.querySelector("#interpretation-main_consequence")).toBeVisible();
  });

  it("主线实际解释空间差异、逆欧拉类、留数及拉回，而不是只有引用名称", () => {
    const { container } = render(<RelationsReading data={propositionData} />);
    const main = container.querySelector("#interpretation-main_consequence")!.parentElement!;
    expect(main).toHaveTextContent("核的维数可能变化");
    expect(main).toHaveTextContent("核维数减去余核维数");
    expect(main).toHaveTextContent("不是更换了定向");
    expect(main).toHaveTextContent("有限级数展开");
    expect(main).toHaveTextContent("拉回逐项作用于 Laurent 系数");
    expect(main).toHaveTextContent("平移留数变量");
    expect(main).toHaveTextContent("只在任意一个极点");
    expect(main.querySelectorAll(".katex-display").length).toBeGreaterThanOrEqual(5);
    expect(main.querySelector(".react-flow, .math-text__fallback, .katex-error")).not.toBeInTheDocument();
    const contents = screen.getByRole("navigation", { name: "关系解读目录" });
    expect(within(contents).getAllByRole("link")).toHaveLength(8);
    for (const link of within(contents).getAllByRole("link")) {
      expect(container.querySelector(link.getAttribute("href")!)).toBeInTheDocument();
    }
  });

  it("关系正文采用无卡片公式排版，保留可访问的公式名称、原公式及全部段落", () => {
    const { container } = render(<RelationsReading data={propositionData} />);
    for (const relation of propositionData.relations) {
      const analysis = propositionData.relation_analysis[relation.relation];
      const interpretation = container.querySelector(`#interpretation-${relation.relation}`)!.parentElement!;
      const sections = interpretation.querySelectorAll(".relation-interpretation__section");
      analysis.sections.forEach((section, sectionIndex) => {
        const rendered = sections[sectionIndex];
        const paragraphs = rendered.querySelectorAll(":scope > p");
        expect(paragraphs).toHaveLength(section.blocks.filter((block) => block.type === "paragraph").length);
        for (const paragraph of paragraphs) expect(paragraph).toBeVisible();
        const formulas = section.blocks.filter((block) => block.type === "formula");
        const figures = rendered.querySelectorAll(":scope > figure");
        expect(figures).toHaveLength(formulas.length);
        formulas.forEach((formula, formulaIndex) => {
          const figure = figures[formulaIndex];
          expect(figure).toHaveClass("reading-equation");
          const caption = figure.querySelector("figcaption")!;
          expect(caption).toHaveClass("visually-hidden");
          expect(caption).not.toHaveAttribute("aria-hidden", "true");
          expect(within(figure as HTMLElement).getByRole("group", { name: formula.label })).toBeVisible();
          expect(figure.querySelector("annotation")).toHaveTextContent(formula.latex.replace(/\s+/g, " "));
        });
      });
    }
  });

  it("展开原文陈述仍显示公式说明，并保留可展开的证据与对应 PDF 页链接", async () => {
    const user = userEvent.setup();
    const { container } = render(<RelationsReading data={propositionData} />);
    const expected = propositionData.related_statements.main_consequence;
    await user.click(screen.getByRole("button", { name: "定理 3.1（跨墙公式）" }));
    const statement = container.querySelector("#related-statement-main_consequence")!;
    const figures = statement.querySelectorAll(":scope > figure");
    const formulas = expected.blocks.filter((block) => block.type === "formula");
    expect(figures).toHaveLength(formulas.length);
    formulas.forEach((formula, index) => {
      const figure = figures[index];
      expect(figure).not.toHaveClass("reading-equation");
      const caption = figure.querySelector("figcaption")!;
      expect(caption).not.toHaveClass("visually-hidden");
      expect(caption).toBeVisible();
      expect(caption).toHaveTextContent(formula.label);
    });
    const evidence = statement.querySelector(":scope > .relations-reading__evidence")!;
    const evidenceText = evidence.querySelector("p")!;
    expect(evidenceText).not.toBeVisible();
    await user.click(evidence.querySelector("summary")!);
    expect(evidenceText).toBeVisible();
    expect(evidenceText).toHaveTextContent(expected.evidence);
    expect(evidence.querySelector(".evidence-badge")).toHaveTextContent("原文明示");
    for (const page of expected.source_page.pdf) {
      const link = within(evidence as HTMLElement).getByRole("link", {
        name: `在论文中查看，PDF 第 ${page} 页（在新标签页打开）`,
      });
      expect(link).toBeVisible();
      expect(link).toHaveAttribute("href", `/papers/wall-crossing-symplectic-vortices.pdf#page=${page}&zoom=page-fit`);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });
});
