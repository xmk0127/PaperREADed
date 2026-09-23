import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { propositionData } from "@/lib/proposition-data";
import { formatSourcePages } from "@/lib/presentation";

import { tokenizeMathText } from "./math-text";
import { PaperReader } from "./paper-reader";

function stubHealthyBackend() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: "ok", message: "后端连接正常" }),
  }));
}

describe("PaperReader", () => {
  it("没有本机示例 PDF 时证明和页码仍可阅读，不出现失效的原文链接", async () => {
    stubHealthyBackend();
    const { container } = render(<PaperReader data={propositionData} initialTab="proof" paperPdfAvailable={false} />);
    await screen.findByText("前后端已连接");
    expect(screen.getByRole("article", { name: "命题 4.1 的证明解读" })).toBeVisible();
    expect(container.querySelector("#formula-definition-17 .katex")).toBeVisible();
    expect(container.querySelectorAll('a[href^="/papers/"]')).toHaveLength(0);
    expect(screen.getAllByText(/本机未附带示例 PDF/).length).toBeGreaterThan(0);
    expect(container.querySelector("#formula-definition-17 .source-meta__pages")).toHaveTextContent("PDF 第 12 页 · 论文第 144 页");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("用中文呈现四个标签页，把符号并入概览，并且不嵌入 PDF 阅读器", async () => {
    const user = userEvent.setup();
    stubHealthyBackend();
    const { container } = render(<PaperReader data={propositionData} />);
    await screen.findByText("前后端已连接");

    expect(screen.getByText("PaperREADed")).toBeVisible();
    expect(screen.queryByText("数学论文阅读器")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "命题 4.1", level: 1 })).toBeInTheDocument();
    expect(container.querySelector("iframe")).not.toBeInTheDocument();
    const resultRail = screen.getByRole("complementary", { name: "当前命题摘要" });
    expect(within(resultRail).getByRole("tablist", { name: "命题分析选项" })).toBeInTheDocument();
    expect(within(resultRail).getAllByRole("tab").map((tab) => tab.textContent?.replace("→", ""))).toEqual([
      "概览", "证明", "关系", "为什么重要",
    ]);
    expect(screen.queryByRole("tab", { name: "符号" })).not.toBeInTheDocument();
    expect(screen.getByText("命题原文")).toBeInTheDocument();
    expect(screen.getByText("一句话解释")).toBeInTheDocument();
    expect(screen.getByText("证明策略")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "在论文中查看，PDF 第 13 页（在新标签页打开）" })).not.toHaveLength(0);

    expect(screen.getByText("15 个符号与相关定义")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "公式中的符号" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "证明" }));
    expect(screen.getByRole("article", { name: "命题 4.1 的证明解读" })).toBeVisible();
    expect(screen.queryByLabelText("证明依赖图")).not.toBeInTheDocument();
    expect(container.querySelector(".react-flow")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /步骤 \d/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "关系" }));
    expect(screen.getByRole("article", { name: propositionData.relations_reading.title })).toBeVisible();
    expect(screen.queryByLabelText("命题关系图")).not.toBeInTheDocument();
    expect(container.querySelector(".react-flow")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".relations-reading__item")).toHaveLength(8);

    await user.click(screen.getByRole("tab", { name: "为什么重要" }));
    expect(screen.getByRole("article", { name: "这个结论在论文中的作用" })).toBeVisible();
    // Scope the query to the text-only section heading; other headings contain
    // MathML, whose computed styles are not implemented completely by JSDOM.
    const reductionHeading = container.querySelector("#importance-reduction");
    expect(reductionHeading).toHaveTextContent(propositionData.importance_reading.comparison.title);
    expect(reductionHeading).toBeVisible();
    expect(screen.getByRole("figure", { name: "切除奇异点集前后的边界示意" })).toBeVisible();
    expect(screen.getByRole("list", { name: "四个结论各自完成的计算" })).toBeVisible();
  });

  it("概览在命题陈述及公式后直接解释全部符号，再显示直观解释和证明策略", async () => {
    stubHealthyBackend();
    render(<PaperReader data={propositionData} />);
    await screen.findByText("前后端已连接");

    const overview = screen.getByRole("tabpanel", { name: "概览" });
    const statement = overview.querySelector(".statement-card")!;
    const symbols = within(overview).getByRole("region", { name: "公式中的符号" });
    const explanation = within(overview).getByText("一句话解释").closest("article")!;
    const strategy = within(overview).getByText("证明策略").closest("article")!;
    expect(statement.querySelector(".katex-display")).toBeVisible();
    expect(statement.nextElementSibling).toBe(symbols);
    expect(symbols).toHaveAttribute("id", "overview-symbols");
    expect(symbols).toHaveAttribute("aria-labelledby", "overview-symbols-title");
    expect(symbols.compareDocumentPosition(explanation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(explanation.compareDocumentPosition(strategy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const rows = symbols.querySelectorAll("dl > .symbol-row");
    expect(rows).toHaveLength(15);
    expect(rows).toHaveLength(propositionData.symbols.length);
    propositionData.symbols.forEach((symbol, index) => {
      const row = rows[index];
      const term = row.querySelector("dt")!;
      const definition = row.querySelector("dd")!;
      const text = definition.querySelector("p")!;
      expect(term).toBeVisible();
      expect(term.querySelector(".katex")).toBeVisible();
      expect(term.querySelector("annotation")?.textContent).toBe(symbol.symbol);
      expect(text).toBeVisible();
      expect(text.closest("details")).toBeNull();
      for (const [element, content] of [[term, symbol.meaning], [text, symbol.explanation]] as const) {
        for (const token of tokenizeMathText(content)) {
          if (token.kind === "math") {
            expect(Array.from(element.querySelectorAll("annotation")).map((annotation) => annotation.textContent)).toContain(token.value);
          } else if (token.value.trim()) {
            expect(element).toHaveTextContent(token.value.trim());
          }
        }
      }
      const meta = row.querySelector(".symbol-row__meta")!;
      expect(meta).toBeVisible();
      expect(meta.querySelector(".evidence-badge")).toHaveTextContent(symbol.inferred ? "推断" : "原文明示");
      expect(meta).toHaveTextContent(formatSourcePages(symbol.source_page));
      expect(row.querySelector(".symbol-evidence")).not.toHaveAttribute("open");
    });
    expect(symbols.querySelectorAll(".symbol-row__meta .evidence-badge--inferred")).toHaveLength(1);
    expect(symbols.querySelector(".katex-error, .math-text__fallback")).not.toBeInTheDocument();
  });

  it("符号解释默认可读，展开证据后仍可核对原文并跳转对应 PDF 页", async () => {
    const user = userEvent.setup();
    stubHealthyBackend();
    render(<PaperReader data={propositionData} />);
    await screen.findByText("前后端已连接");

    const symbols = screen.getByRole("region", { name: "公式中的符号" });
    const rows = symbols.querySelectorAll(".symbol-row");
    for (const index of [0, 3]) {
      const symbol = propositionData.symbols[index];
      const row = rows[index];
      const explanation = row.querySelector("dd > p")!;
      const details = row.querySelector<HTMLDetailsElement>(".symbol-evidence")!;
      expect(explanation).toBeVisible();
      expect(details.querySelector("a")).not.toBeVisible();
      await user.click(details.querySelector("summary")!);
      expect(details).toHaveAttribute("open");
      expect(details.querySelector("blockquote")).toBeVisible();
      expect(details.querySelector(".source-meta .evidence-badge")).toHaveTextContent(symbol.inferred ? "推断" : "原文明示");
      expect(details.querySelector(".source-meta")).toHaveTextContent(formatSourcePages(symbol.source_page));
      for (const page of symbol.source_page.pdf) {
        const link = within(details).getByRole("link", { name: `在论文中查看，PDF 第 ${page} 页（在新标签页打开）` });
        expect(link).toBeVisible();
        expect(link).toHaveAttribute("href", `/papers/wall-crossing-symplectic-vortices.pdf#page=${page}&zoom=page-fit`);
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noreferrer");
      }
      await user.click(details.querySelector("summary")!);
      expect(details.querySelector("blockquote")).not.toBeVisible();
      expect(explanation).toBeVisible();
      expect(row.querySelector(".symbol-row__meta")).toBeVisible();
    }
  });

  it("重要性直接显示归约对照、边界示意和四个结论的公式，不使用箭头画布", async () => {
    stubHealthyBackend();
    render(<PaperReader data={propositionData} initialTab="importance" />);
    await screen.findByText("前后端已连接");

    const article = screen.getByRole("article", { name: "这个结论在论文中的作用" });
    const { comparison, geometry, calculation } = propositionData.importance_reading;
    expect(article).toBeVisible();
    expect(within(article).getByRole("heading", { level: 2 })).toHaveAttribute("id", "importance-reading-title");
    expect(within(article).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      comparison.title, geometry.title, calculation.title, "不要从这个命题多推出一步",
    ]);
    expect(article.querySelector(".react-flow, canvas, svg marker, [marker-end], [marker-start]")).not.toBeInTheDocument();
    expect(within(article).getByLabelText("归约前后的数学任务对照")).toBeVisible();

    for (const item of [comparison.notation, comparison.before, comparison.after, geometry.condition, geometry.identity, ...calculation.rows]) {
      const formula = within(article).getByRole("group", { name: item.label });
      expect(formula.querySelector(".katex-display")).toBeVisible();
      expect(formula.querySelector("annotation")?.textContent).toBe(item.latex);
      expect(formula.closest("details")).toBeNull();
    }

    const schematic = within(article).getByRole("figure", { name: "切除奇异点集前后的边界示意" });
    expect(schematic.querySelectorAll("svg")).toHaveLength(2);
    for (const panel of geometry.panels) {
      expect(within(schematic).getByText(panel.center_label)).toBeVisible();
      expect(within(schematic).getByText(panel.caption)).toBeVisible();
      const math = Array.from(schematic.querySelectorAll("annotation")).map((annotation) => annotation.textContent);
      expect(math).toEqual(expect.arrayContaining([panel.space, panel.top, panel.bottom, panel.center]));
    }
    expect(schematic.querySelector("figcaption")).toHaveTextContent("不表示实际维数、形状或光滑性");
    expect(schematic.querySelector("figcaption")).toHaveTextContent("不能从这幅图猜");

    const calculationList = within(article).getByRole("list", { name: "四个结论各自完成的计算" });
    const rows = within(calculationList).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    calculation.rows.forEach((item, index) => {
      expect(within(rows[index]).getByRole("heading", { name: item.label })).toBeVisible();
      expect(within(rows[index]).getByRole("group", { name: item.label })).toBeVisible();
    });
    expect(within(article).getByRole("complementary", { name: "作用的边界" })).toBeVisible();
    expect(article.querySelector(".katex-error, .math-text__fallback")).not.toBeInTheDocument();
  });

  it("重要性每项解读保留可展开的来源和 PDF 页码，收起来源不会隐藏主公式", async () => {
    const user = userEvent.setup();
    stubHealthyBackend();
    render(<PaperReader data={propositionData} initialTab="importance" />);
    await screen.findByText("前后端已连接");

    const article = screen.getByRole("article", { name: "这个结论在论文中的作用" });
    const { lead, comparison, geometry, calculation, limits } = propositionData.importance_reading;
    const items = [lead, comparison.notation, comparison.before, comparison.after,
      geometry.introduction, geometry.caution, geometry.condition, geometry.identity,
      calculation.introduction, ...calculation.rows, calculation.conclusion, limits];
    const disclosures = Array.from(article.querySelectorAll<HTMLDetailsElement>("details"))
      .filter((details) => details.querySelector("blockquote"));
    expect(disclosures).toHaveLength(items.length);
    for (const [index, item] of items.entries()) {
      const details = disclosures[index];
      const summary = details.querySelector("summary")!;
      expect(details).not.toHaveAttribute("open");
      expect(summary).toBeVisible();
      expect(summary).toHaveTextContent(formatSourcePages(item.source_page));
      expect(summary.querySelector(".evidence-badge")).toHaveTextContent(item.inferred ? "推断" : "原文明示");
      expect(details.querySelector("a")).not.toBeVisible();
      await user.click(summary);
      expect(details).toHaveAttribute("open");
      const quote = details.querySelector("blockquote")!;
      expect(quote).toBeVisible();
      for (const token of tokenizeMathText(item.evidence)) {
        if (token.kind === "math") {
          expect(Array.from(quote.querySelectorAll("annotation")).map((annotation) => annotation.textContent)).toContain(token.value);
        } else if (token.value.trim()) {
          expect(quote).toHaveTextContent(token.value.trim());
        }
      }
      expect(details.querySelector(".source-meta")).toHaveTextContent(formatSourcePages(item.source_page));
      expect(details.querySelector(".source-meta .evidence-badge")).toHaveTextContent(item.inferred ? "推断" : "原文明示");
      expect(within(details).getAllByRole("link")).toHaveLength(new Set(item.source_page.pdf).size);
      for (const page of item.source_page.pdf) {
        const link = within(details).getByRole("link", { name: "在论文中查看，PDF 第 " + page + " 页（在新标签页打开）" });
        expect(link).toBeVisible();
        expect(link).toHaveAttribute("href", "/papers/wall-crossing-symplectic-vortices.pdf#page=" + page + "&zoom=page-fit");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noreferrer");
      }
      await user.click(summary);
      expect(details).not.toHaveAttribute("open");
      expect(quote).not.toBeVisible();
      expect(details.querySelector("a")).not.toBeVisible();
      expect(summary).toBeVisible();
    }
    expect(within(article).getByRole("group", { name: comparison.after.label })).toBeVisible();
    expect(within(article).getByRole("group", { name: geometry.identity.label })).toBeVisible();
  });

  it("可展开最终类的具体留数公式，收起后仍能直接看到定理 3.1 的结论", async () => {
    const user = userEvent.setup();
    stubHealthyBackend();
    render(<PaperReader data={propositionData} initialTab="importance" />);
    await screen.findByText("前后端已连接");

    const { main_consequence: statement } = propositionData.related_statements;
    const formula = statement.blocks.filter((block) => block.type === "formula")[1];
    const summary = screen.getByText("展开 α₀ 的具体公式");
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details.querySelector(".katex-display")).not.toBeVisible();
    await user.click(summary);
    expect(details).toHaveAttribute("open");
    expect(within(details).getByRole("group", { name: formula.label })).toBeVisible();
    expect(details.querySelector("annotation")?.textContent).toBe(formula.latex);
    for (const page of statement.source_page.pdf) {
      expect(within(details).getByRole("link", { name: "在论文中查看，PDF 第 " + page + " 页（在新标签页打开）" })).toHaveAttribute(
        "href", "/papers/wall-crossing-symplectic-vortices.pdf#page=" + page + "&zoom=page-fit",
      );
    }
    await user.click(summary);
    expect(details.querySelector(".katex-display")).not.toBeVisible();
    expect(screen.getByRole("group", { name: propositionData.importance_reading.calculation.rows[3].label })).toBeVisible();
  });

  it("关系页优先解释核心作用，直接显示全部八条关系的用途而不是箭头图", async () => {
    stubHealthyBackend();
    const { container } = render(<PaperReader data={propositionData} initialTab="relations" />);
    await screen.findByText("前后端已连接");

    const article = screen.getByRole("article", { name: propositionData.relations_reading.title });
    expect(within(article).getByText(/不直接算出最终的跨墙公式/)).toBeVisible();
    expect(article.querySelector("header .evidence-badge")).toHaveTextContent("推断");
    expect(container.querySelector(".react-flow, .reading-flow, .node-detail")).not.toBeInTheDocument();
    expect(within(article).queryByText("当前关系")).not.toBeInTheDocument();
    expect(within(article).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(
      propositionData.relations_reading.groups.map((group) => group.title),
    );

    for (const relation of propositionData.relations) {
      const row = within(article).getByRole("region", { name: relation.target });
      const explanation = row.querySelector(".relations-reading__explanation")!;
      expect(explanation).toBeVisible();
      expect(explanation.closest("details")).toBeNull();
      expect(explanation).toHaveTextContent(propositionData.relation_analysis[relation.relation].lead.split("\\(")[0]);
      const citation = row.querySelector(".relations-reading__association-evidence")!;
      expect(citation.querySelector("summary .evidence-badge")).toHaveTextContent(relation.inferred ? "推断" : "原文明示");
      expect(citation.querySelector("summary")).toHaveTextContent(`PDF 第 ${relation.source_page.pdf.join(", ")} 页`);
    }

    const foundations = article.querySelector("#relations-proof-foundations")!;
    expect(within(foundations as HTMLElement).getByRole("heading", { name: "定理 A.4" })).toBeVisible();
    expect(within(foundations as HTMLElement).queryByRole("heading", { name: "定理 4.10" })).not.toBeInTheDocument();
    expect(article.querySelector("#relations-main-result")).toHaveTextContent("结合公式 (39)，再使用引理 4.12");
    expect(article.querySelector(".katex-error, .math-text__fallback")).not.toBeInTheDocument();
  });

  it("关系说明始终展开，仅原文依据折叠，保留原文页码和 PDF 跳转", async () => {
    const user = userEvent.setup();
    stubHealthyBackend();
    render(<PaperReader data={propositionData} initialTab="relations" />);
    await screen.findByText("前后端已连接");

    const row = screen.getByRole("region", { name: "公式 (39)" });
    const details = row.querySelector<HTMLDetailsElement>(".relations-reading__association-evidence")!;
    const explanation = row.querySelector(".relations-reading__explanation")!;
    expect(explanation).toBeVisible();
    expect(details.querySelector("p")).not.toBeVisible();
    expect(details.querySelector("summary")).toHaveTextContent("PDF 第 31 页 · 论文第 163 页");
    await user.click(details.querySelector("summary")!);
    expect(details.querySelector("p")).toBeVisible();
    expect(details.querySelectorAll("p")[1]).toHaveTextContent(propositionData.relations.find((relation) => relation.relation === "downstream_rewrite")!.evidence);
    const link = within(details).getByRole("link", { name: "在论文中查看，PDF 第 31 页（在新标签页打开）" });
    expect(link).toHaveAttribute("href", "/papers/wall-crossing-symplectic-vortices.pdf#page=31&zoom=page-fit");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    await user.click(details.querySelector("summary")!);
    expect(explanation).toBeVisible();
    expect(link).not.toBeVisible();
  });

  it("证明优先呈现目标、两个关键等式与四组条件推理，公式无需展开且没有箭头画布", async () => {
    stubHealthyBackend();
    render(<PaperReader data={propositionData} initialTab="proof" />);
    await screen.findByText("前后端已连接");

    const { logic, logic_formulas, steps } = propositionData.proof;
    const formulas = new Map([...steps.flatMap((step) => step.formulas), ...logic_formulas].map((formula) => [formula.id, formula]));
    const article = screen.getByRole("article", { name: logic.title });
    const assertVisibleFormula = (id: string, scope: Element = article) => {
      const figure = scope.querySelector("#formula-" + id)!;
      expect(figure).toBeVisible();
      expect(figure.closest("details")).toBeNull();
      expect(figure.querySelector(".katex-display")).toBeVisible();
      expect(figure.querySelector("annotation")?.textContent).toBe(formulas.get(id)!.latex);
    };
    assertVisibleFormula(logic.goal_formula_id, article.querySelector("header")!);
    const backbone = article.querySelector('section[aria-labelledby="proof-backbone-title"]')!;
    expect(backbone.querySelector("h3")).toHaveTextContent("证明主线");
    expect(Array.from(backbone.querySelectorAll("h4")).map((heading) => heading.textContent)).toEqual(logic.backbone.map((item) => item.label));
    for (const item of logic.backbone) {
      assertVisibleFormula(item.formula_id, backbone);
      expect(backbone).toHaveTextContent(item.reason);
    }
    const setup = article.querySelector('section[aria-labelledby="proof-setup-title"]')!;
    expect(setup.querySelector("h3")).toHaveTextContent(logic.setup.title);
    for (const id of logic.setup.formula_ids) assertVisibleFormula(id, setup);
    assertVisibleFormula("vortex-equations-6", setup);

    for (const argument of logic.arguments) {
      const section = article.querySelector("#proof-logic-" + argument.id)!;
      expect(section.querySelector("h3")).toHaveTextContent(argument.title);
      for (const id of argument.formula_ids) assertVisibleFormula(id, section);
      expect(Array.from(section.querySelectorAll("dt")).map((term) => term.textContent)).toEqual(["使用条件", "关键推理", "得到"]);
      const explanations = section.querySelectorAll("dd");
      const conditions = explanations[0].querySelectorAll("li");
      expect(conditions).toHaveLength(argument.uses.length);
      const items: Array<[Element, string]> = [
        ...argument.uses.map((condition, index): [Element, string] => [conditions[index], condition]),
        [explanations[1], argument.reason],
        [explanations[2], argument.result],
      ];
      for (const [element, content] of items) {
        expect(element).toBeVisible();
        expect(element.closest("details")).toBeNull();
        for (const token of tokenizeMathText(content)) {
          if (token.kind === "math") {
            expect(Array.from(element.querySelectorAll("annotation")).map((node) => node.textContent)).toContain(token.value);
          } else if (token.value.trim()) {
            expect(element).toHaveTextContent(token.value.trim());
          }
        }
      }
    }
    expect(article.querySelector(".react-flow, canvas, svg marker")).not.toBeInTheDocument();
    expect(article.querySelector(".katex-error, .math-text__fallback")).not.toBeInTheDocument();
    const ids = Array.from(article.querySelectorAll("[id]")).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("归一化前默认完整展示定义（17），三条方程、取商定义及原文页码都能直接核对", async () => {
    const user = userEvent.setup();
    stubHealthyBackend();
    render(<PaperReader data={propositionData} initialTab="proof" />);
    await screen.findByText("前后端已连接");

    const section = document.getElementById("proof-logic-normalize-and-finish")!;
    const definition = section.querySelector("#formula-definition-17")!;
    const normalization = section.querySelector("#formula-logic-normalization")!;
    const source = propositionData.proof.logic_formulas.find((formula) => formula.id === "definition-17")!;
    expect(definition).toBeVisible();
    expect(definition.closest("details")).toBeNull();
    expect(section.querySelector("figure")).toBe(definition);
    expect(definition.nextElementSibling).toBe(normalization);
    expect(definition.querySelector("figcaption")).toHaveTextContent("定义（17）");
    expect(definition.querySelector(".katex-display")).toBeVisible();
    const latex = definition.querySelector("annotation")?.textContent;
    expect(latex).toBe(source.latex);
    // A unit-norm condition alone is not the definition: keep all three
    // equations and the based gauge quotient visible at this point of use.
    expect(latex).toContain("\\bar\\partial_Au_\\nu&=0");
    expect(latex).toContain("\\nu=1,\\ldots,n");
    expect(latex).toContain("*F_A+\\pi\\sum_{\\nu\\in I}|u_\\nu|^2w_\\nu");
    expect(latex).toContain("\\tau_0");
    expect(latex).toContain("\\sum_{\\nu\\notin I}\\|u_\\nu\\|_{L^2}^2&=1");
    expect(latex).toContain("\\mathcal P_0");
    expect(latex).toContain("/\\mathcal G_0");
    expect(source.inferred).toBe(false);
    expect(source.source_page).toEqual({ pdf: [12], printed: [144] });

    const details = definition.querySelector<HTMLDetailsElement>("details")!;
    const summary = details.querySelector("summary")!;
    expect(details).not.toHaveAttribute("open");
    expect(summary.querySelector(".evidence-badge")).toHaveTextContent("原文明示");
    expect(summary).toHaveTextContent("PDF 第 12 页");
    await user.click(summary);
    expect(details.querySelector(".source-meta")).toHaveTextContent("PDF 第 12 页 · 论文第 144 页");
    const link = within(details).getByRole("link", { name: "在论文中查看，PDF 第 12 页（在新标签页打开）" });
    expect(link).toBeVisible();
    expect(link).toHaveAttribute("href", "/papers/wall-crossing-symplectic-vortices.pdf#page=12&zoom=page-fit");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    await user.click(summary);
    expect(details).not.toHaveAttribute("open");
    expect(definition.querySelector(".katex-display")).toBeVisible();
    expect(normalization.querySelector(".katex-display")).toBeVisible();
    expect(section.querySelector(".katex-error, .math-text__fallback")).not.toBeInTheDocument();
  });

  it("长篇技术解释默认收起，展开后保留原段落和公式且不会产生重复锚点", async () => {
    const user = userEvent.setup();
    stubHealthyBackend();
    render(<PaperReader data={propositionData} initialTab="proof" />);
    await screen.findByText("前后端已连接");

    const article = screen.getByRole("article", { name: propositionData.proof.logic.title });
    const summary = within(article).getByText("展开完整解释与技术细节", { selector: "summary" });
    const disclosure = summary.closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    for (const section of propositionData.proof.narrative.sections) {
      expect(article.querySelector("#proof-full-" + section.id)).not.toBeInTheDocument();
    }
    await user.click(summary);
    await waitFor(() => expect(article.querySelector("#proof-full-" + propositionData.proof.narrative.sections[0].id)).toBeVisible());
    for (const section of propositionData.proof.narrative.sections) {
      const renderedSection = article.querySelector("#proof-full-" + section.id)!;
      expect(renderedSection.querySelector("h3")).toHaveTextContent(section.title);
      const blocks = Array.from(renderedSection.children).filter((child) => ["P", "FIGURE"].includes(child.tagName));
      expect(blocks).toHaveLength(section.blocks.length);
      section.blocks.forEach((block, index) => {
        expect(blocks[index]).toBeVisible();
        if (block.type === "formula") {
          expect(blocks[index]).toHaveAttribute("id", "formula-full-" + section.id + "-" + index + "-" + block.formula_id);
          expect(blocks[index].querySelector(".katex-display")).toBeVisible();
        } else {
          expect(blocks[index].tagName).toBe("P");
          for (const token of tokenizeMathText(block.text).filter((item) => item.kind === "text" && item.value.trim())) {
            expect(blocks[index]).toHaveTextContent(token.value.trim());
          }
        }
      });
    }
    const ids = Array.from(article.querySelectorAll("[id]")).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(article.querySelector(".katex-error, .math-text__fallback")).not.toBeInTheDocument();
    await user.click(summary);
    await waitFor(() => expect(article.querySelector("#proof-full-" + propositionData.proof.narrative.sections[0].id)).not.toBeInTheDocument());
    expect(article.querySelector("#formula-" + propositionData.proof.logic.goal_formula_id + " .katex-display")).toBeVisible();
  });

  it("公式区分原文方程与补充推导，展开来源可核对证据和准确 PDF 页码", async () => {
    const user = userEvent.setup();
    stubHealthyBackend();
    render(<PaperReader data={propositionData} initialTab="proof" />);
    await screen.findByText("前后端已连接");

    const formulas = [...propositionData.proof.steps.flatMap((step) => step.formulas), ...propositionData.proof.logic_formulas];
    for (const id of ["vortex-equations-6", "logic-goal", "logic-cutoff-estimate", "logic-homotopy", "logic-normalization"]) {
      const source = formulas.find((formula) => formula.id === id)!;
      const figure = document.getElementById("formula-" + id)!;
      const evidence = figure.querySelector<HTMLDetailsElement>("details")!;
      const summary = evidence.querySelector("summary")!;
      expect(summary.querySelector(".evidence-badge")).toHaveTextContent(source.inferred ? "推断" : "原文明示");
      expect(summary).toHaveTextContent("PDF 第 " + source.source_page.pdf.join("、") + " 页");
      expect(evidence.querySelector("p")).not.toBeVisible();
      expect(evidence.querySelector("a")).not.toBeVisible();
      await user.click(summary);
      for (const token of tokenizeMathText(source.evidence)) {
        if (token.kind === "math") {
          expect(Array.from(evidence.querySelectorAll("p annotation")).map((node) => node.textContent)).toContain(token.value);
        } else if (token.value.trim()) {
          expect(evidence.querySelector("p")).toHaveTextContent(token.value.trim());
        }
      }
      expect(evidence.querySelector("p")).toBeVisible();
      expect(evidence.querySelector(".source-meta")).toHaveTextContent(formatSourcePages(source.source_page));
      for (const page of source.source_page.pdf) {
        const link = within(evidence).getByRole("link", { name: "在论文中查看，PDF 第 " + page + " 页（在新标签页打开）" });
        expect(link).toBeVisible();
        expect(link).toHaveAttribute("href", "/papers/wall-crossing-symplectic-vortices.pdf#page=" + page + "&zoom=page-fit");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noreferrer");
      }
      await user.click(summary);
      expect(evidence.querySelector("p")).not.toBeVisible();
      expect(figure.querySelector(".katex-display")).toBeVisible();
    }
  });

  it("切换标签同步可分享的查询参数，并保留其他参数与锚点", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?paper=wall-crossing#reading");
    stubHealthyBackend();
    render(<PaperReader data={propositionData} />);
    await screen.findByText("前后端已连接");

    await user.click(screen.getByRole("tab", { name: "证明" }));
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("proof");
    expect(new URLSearchParams(window.location.search).get("paper")).toBe("wall-crossing");
    expect(window.location.hash).toBe("#reading");
    expect(screen.getByRole("tab", { name: "证明" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "证明" })).toBeVisible();
  });

  it("支持用纵向方向键切换侧栏标签页", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<PaperReader data={propositionData} />);
    const overviewTab = screen.getByRole("tab", { name: "概览" });
    overviewTab.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("tab", { name: "证明" })).toHaveFocus();
    expect(screen.getByRole("article", { name: "命题 4.1 的证明解读" })).toBeVisible();
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("proof");
    await user.keyboard("{ArrowUp}");
    expect(overviewTab).toHaveFocus();
    expect(screen.getByText("命题陈述与符号说明")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "公式中的符号" })).toBeVisible();
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("overview");
  });
});
