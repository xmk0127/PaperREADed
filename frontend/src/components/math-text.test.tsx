import { render } from "@testing-library/react";
import { renderToString } from "katex";
import { describe, expect, it } from "vitest";

import { propositionData } from "@/lib/proposition-data";

import { MathText, tokenizeMathText } from "./math-text";

function importanceReadingFormulas() {
  const { comparison, geometry, calculation } = propositionData.importance_reading;
  return [comparison.notation, comparison.before, comparison.after, geometry.condition, geometry.identity, ...calculation.rows];
}

function importanceReadingSources() {
  const { lead, geometry, calculation, limits } = propositionData.importance_reading;
  return [lead, ...importanceReadingFormulas(), geometry.introduction, geometry.caution,
    calculation.introduction, calculation.conclusion, limits];
}

function mixedTextCorpus() {
  const { statement, intuitive_explanation: intuitive, symbols, proof, relations, relations_reading, related_statements, relation_analysis, importance } =
    propositionData;

  return [
    statement.text,
    statement.evidence,
    intuitive.text,
    intuitive.evidence,
    proof.goal.text,
    proof.goal.evidence,
    proof.strategy.text,
    proof.strategy.evidence,
    proof.narrative.title,
    proof.narrative.introduction.text,
    proof.narrative.introduction.evidence,
    proof.logic.title,
    proof.logic.notation,
    proof.logic.setup.title,
    proof.logic.setup.context,
    proof.logic.setup.evidence,
    ...proof.logic.backbone.flatMap(({ label, reason }) => [label, reason]),
    ...proof.logic.arguments.flatMap(({ title, uses, reason, result, evidence }) => [title, ...uses, reason, result, evidence]),
    proof.logic.conclusion.text,
    proof.logic.conclusion.evidence,
    ...proof.logic_formulas.flatMap(({ label, explanation, evidence }) => [label, explanation, evidence]),
    ...proof.narrative.sections.flatMap((section) => [
      section.title,
      section.evidence,
      ...section.blocks.flatMap((block) => block.type === "paragraph" ? [block.text] : []),
    ]),
    ...symbols.flatMap(({ meaning, explanation, evidence }) => [meaning, explanation, evidence]),
    ...proof.steps.flatMap(({ claim, depends_on, explanation, evidence, analysis, formulas, prerequisites }) => [
      claim,
      ...depends_on,
      explanation,
      evidence,
      analysis.title,
      analysis.summary,
      analysis.problem,
      analysis.reasoning,
      analysis.outcome,
      analysis.caution,
      analysis.evidence,
      ...formulas.flatMap((formula) => [formula.label, formula.explanation, formula.evidence]),
      ...prerequisites.flatMap((item) => [item.label, item.text, item.evidence]),
    ]),
    ...relations.flatMap(({ explanation, evidence }) => [explanation, evidence]),
    relations_reading.title,
    relations_reading.summary.text,
    relations_reading.summary.evidence,
    ...relations_reading.groups.map((group) => group.title),
    ...Object.values(related_statements).flatMap((statement) => [
      statement.scope,
      statement.evidence,
      ...statement.blocks.map((block) => block.type === "paragraph" ? block.text : block.label),
      ...statement.context.flatMap((item) => [item.label, item.text]),
    ]),
    ...Object.values(relation_analysis).flatMap((analysis) => [
      analysis.title, analysis.lead, analysis.evidence,
      ...analysis.sections.flatMap((section) => [
        section.title, section.evidence,
        ...section.blocks.map((block) => block.type === "paragraph" ? block.text : block.label),
      ]),
    ]),
    ...Object.values(importance).flatMap(({ text, evidence }) => [text, evidence]),
    ...importanceReadingSources().flatMap(({ text, evidence }) => [text, evidence]),
    ...importanceReadingFormulas().map((formula) => formula.label),
    propositionData.importance_reading.comparison.title,
    propositionData.importance_reading.geometry.title,
    propositionData.importance_reading.calculation.title,
    ...propositionData.importance_reading.geometry.panels.flatMap((panel) => [panel.title, panel.center_label, panel.caption]),
  ];
}

describe("MathText", () => {
  it("证明逻辑的目标、两次归约和四组论证引用有效公式，逐条保留数学来源", () => {
    const { logic, logic_formulas, steps } = propositionData.proof;
    const formulas = [...steps.flatMap((step) => step.formulas), ...logic_formulas];
    expect(new Set(formulas.map((formula) => formula.id)).size).toBe(formulas.length);
    expect(logic.backbone).toHaveLength(2);
    expect(logic.arguments).toHaveLength(4);
    expect(new Set(logic.arguments.map((argument) => argument.id)).size).toBe(logic.arguments.length);
    const referencedIds = [logic.goal_formula_id, ...logic.backbone.map((item) => item.formula_id),
      ...logic.setup.formula_ids, ...logic.arguments.flatMap((argument) => argument.formula_ids)];
    for (const id of referencedIds) {
      expect(formulas.filter((formula) => formula.id === id)).toHaveLength(1);
    }
    expect(referencedIds).toContain("vortex-equations-6");
    for (const argument of logic.arguments) {
      expect(argument.formula_ids.length).toBeGreaterThan(0);
      expect(argument.uses.length).toBeGreaterThan(0);
      expect(argument.uses.every((condition) => condition.trim().length > 0)).toBe(true);
      expect(argument.reason.trim()).not.toBe("");
      expect(argument.result.trim()).not.toBe("");
      expect(argument.inferred).toBe(true);
    }
    for (const item of [logic.setup, ...logic.arguments, logic.conclusion, ...logic_formulas]) {
      expect(item.evidence.trim()).not.toBe("");
      expect(typeof item.inferred).toBe("boolean");
      expect(item.source_page.pdf.length).toBeGreaterThan(0);
      expect(item.source_page.pdf.every((page) => Number.isInteger(page) && page > 0 && page <= 60)).toBe(true);
      expect(item.source_page.printed).toEqual(item.source_page.pdf.map((page) => page + 132));
    }
    for (const formula of logic_formulas) {
      expect(formula.label.trim()).not.toBe("");
      expect(formula.explanation.trim()).not.toBe("");
      expect(() => renderToString(formula.latex, { displayMode: true, throwOnError: true, strict: "error" })).not.toThrow();
    }
    const byId = new Map(formulas.map((formula) => [formula.id, formula]));
    expect(byId.get(logic.goal_formula_id)?.inferred).toBe(false);
    expect(byId.get(logic.goal_formula_id)?.source_page).toEqual({ pdf: [13], printed: [145] });
    expect(byId.get(logic.backbone[0].formula_id)?.latex).toContain("\\int_{\\mathcal M^\\delta/T}\\pi^*\\alpha");
    expect(byId.get(logic.backbone[1].formula_id)?.latex).toContain("\\int_{\\mathcal P_0/T}\\pi^*\\alpha");
    expect(byId.get("logic-cutoff-estimate")?.inferred).toBe(true);
    expect(byId.get("logic-normalization")?.inferred).toBe(true);
    expect(byId.get("logic-homotopy")?.inferred).toBe(false);
  });

  it("重要性解读的每项解释有页码及推断标记，独立公式和示意标签均可严格渲染", () => {
    const { geometry, comparison, calculation } = propositionData.importance_reading;
    for (const item of importanceReadingSources()) {
      expect(item.text.trim()).not.toBe("");
      expect(item.evidence.trim()).not.toBe("");
      expect(item.inferred).toBe(true);
      expect(item.source_page.pdf.length).toBeGreaterThan(0);
      expect(item.source_page.pdf.every((page) => Number.isInteger(page) && page > 0 && page <= 60)).toBe(true);
      expect(item.source_page.printed).toEqual(item.source_page.pdf.map((page) => page + 132));
    }
    const formulas = importanceReadingFormulas();
    expect(formulas).toHaveLength(9);
    expect(new Set(formulas.map((formula) => formula.label)).size).toBe(formulas.length);
    for (const formula of formulas) {
      expect(formula.label.trim()).not.toBe("");
      expect(() => renderToString(formula.latex, { displayMode: true, throwOnError: true, strict: "error" })).not.toThrow();
    }
    expect(geometry.panels).toHaveLength(2);
    for (const panel of geometry.panels) {
      expect(panel.caption.trim()).not.toBe("");
      expect(panel.center_label.trim()).not.toBe("");
      for (const math of [panel.space, panel.top, panel.bottom, panel.center]) {
        expect(() => renderToString(math, { throwOnError: true, strict: "error" })).not.toThrow();
      }
    }
    expect(comparison.after.latex).toContain("\\int_{\\mathcal P_0/T}\\pi^*\\alpha");
    expect(geometry.identity.latex).toContain("\\int_{\\mathcal M^\\delta/T}");
    expect(geometry.identity.latex).toContain("\\int_{\\mathcal P_0/T}");
    expect(calculation.rows).toHaveLength(4);
    expect(calculation.rows[1].latex).toContain("=-\\int_{\\mathcal M_0/T_0}\\operatorname{Res}_{\\infty}");
    expect(calculation.rows[2].latex).toContain("d_\\nu+1-g");
    expect(calculation.rows[2].latex).toContain("-\\frac{\\Omega_\\nu}");
    expect(calculation.rows[3].latex).toContain("\\pi_0^*\\alpha_0");
    expect(geometry.caution.text).toContain("不表示实际维数、形状或光滑性");
    expect(calculation.introduction.text).toContain("核的维数可能变化");
  });
  it("八条深度关系解读均有分节论证、桥接公式与逐节来源，并区分教学推导和原文陈述", () => {
    const { relation_analysis: analyses, relations } = propositionData;
    expect(Object.keys(analyses).sort()).toEqual(relations.map((relation) => relation.relation).sort());
    for (const analysis of Object.values(analyses)) {
      expect(analysis.sections.length).toBeGreaterThanOrEqual(2);
      expect(analysis.lead).not.toBe("");
      for (const source of [analysis, ...analysis.sections]) {
        expect(source.inferred).toBe(true);
        expect(source.evidence.trim()).not.toBe("");
        expect(source.source_page.pdf.length).toBeGreaterThan(0);
        expect(source.source_page.printed).toEqual(source.source_page.pdf.map((page) => page + 132));
      }
      const blocks = analysis.sections.flatMap((section) => section.blocks);
      expect(blocks.some((block) => block.type === "formula")).toBe(true);
      for (const block of blocks) {
        if (block.type === "formula") {
          expect(() => renderToString(block.latex, { displayMode: true, throwOnError: true, strict: "error" })).not.toThrow();
        }
      }
    }
    const main = analyses.main_consequence.sections.flatMap((section) => section.blocks);
    const math = main.flatMap((block) => block.type === "formula" ? [block.latex] : []).join("\n");
    expect(math).toContain("E_\\nu(\\xi+ze_1)^{-1}");
    expect(math).toContain("+\\frac{\\Omega_\\nu}");
    expect(math).toContain("-\\operatorname{Res}_{\\infty}");
    expect(math).toContain("\\pi_0^*\\alpha_0");
  });

  it("每条关系都有实际结论、准确来源和可严格渲染的公式，摘录不冒充完整定理", () => {
    const { related_statements: statements, relations } = propositionData;
    expect(Object.keys(statements).sort()).toEqual(relations.map((relation) => relation.relation).sort());
    for (const statement of Object.values(statements)) {
      expect(statement.scope.trim()).not.toBe("");
      expect(statement.evidence.trim()).not.toBe("");
      expect(statement.inferred).toBe(false);
      expect(statement.blocks.some((block) => block.type === "paragraph")).toBe(true);
      expect(statement.blocks.some((block) => block.type === "formula")).toBe(true);
      for (const block of statement.blocks) {
        if (block.type === "formula") {
          expect(() => renderToString(block.latex, { displayMode: true, throwOnError: true, strict: "error" })).not.toThrow();
        }
      }
      for (const item of [statement, ...statement.context]) {
        expect(item.source_page.pdf.length).toBeGreaterThan(0);
        expect(item.source_page.pdf.every((page) => Number.isInteger(page) && page > 0 && page <= 60)).toBe(true);
        expect(item.source_page.printed).toEqual(item.source_page.pdf.map((page) => page + 132));
      }
    }
    expect(statements.main_consequence.source_page).toEqual({ pdf: [10, 11], printed: [142, 143] });
    expect(statements.proof_dependency.scope).toContain("非完整定理");
    expect(statements.orientation_dependency.scope).toContain("非注记全文");
    expect(statements.sign_justification.scope).toContain("非注记全文");
    const formulas = statements.main_consequence.blocks.flatMap((block) => block.type === "formula" ? [block.latex] : []);
    expect(formulas).toHaveLength(2);
    expect(formulas[0]).toContain("\\int_{\\mathcal M_0/T_0}\\pi_0^*\\alpha_0");
    expect(formulas[1]).toContain("d_\\nu+1-g");
    expect(formulas[1]).toContain("\\Omega_\\nu");
    expect(formulas[1]).toContain("\\oint");
  });

  it("关系导读完整且不重复地引用八条原始关系，新增总结标明为推断", () => {
    const { relations, relations_reading: reading } = propositionData;
    const keys = reading.groups.flatMap((group) => group.relations);
    expect(new Set(keys).size).toBe(relations.length);
    expect([...keys].sort()).toEqual(relations.map((relation) => relation.relation).sort());
    expect(reading.groups[0].relations).toEqual(["main_consequence"]);
    expect(reading.groups.find((group) => group.id === "proof-foundations")?.relations).toEqual([
      "proof_dependency", "orientation_dependency", "sign_justification",
    ]);
    expect(reading.summary.inferred).toBe(true);
    for (const source of [reading.summary, ...relations]) {
      expect(source.evidence.trim().length).toBeGreaterThan(0);
      expect(typeof source.inferred).toBe("boolean");
      expect(source.source_page.pdf.length).toBeGreaterThan(0);
      expect(source.source_page.printed).toEqual(source.source_page.pdf.map((page) => page + 132));
    }
  });

  it("把显式定界的行内公式与普通文字分开", () => {
    expect(tokenizeMathText("它在 \\(\\mathbb C^n\\) 上作用，并保留 \\(T\\)-作用。")).toEqual([
      { kind: "text", value: "它在 " },
      { kind: "math", value: "\\mathbb C^n" },
      { kind: "text", value: " 上作用，并保留 " },
      { kind: "math", value: "T" },
      { kind: "text", value: "-作用。" },
    ]);
  });

  it("遇到未闭合定界符时保留原文而不崩溃", () => {
    expect(tokenizeMathText("未闭合 \\(\\tau_0")).toEqual([
      { kind: "text", value: "未闭合 \\(\\tau_0" },
    ]);
  });

  it("使用 KaTeX 渲染上下标、花体和箭头", () => {
    const { container } = render(
      <p>
        <MathText>{"主丛 \\(P\\to\\Sigma\\) 与模空间 \\(\\mathcal P_0/T\\)。"}</MathText>
      </p>,
    );

    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.querySelector(".katex-error")).not.toBeInTheDocument();
    expect(container.querySelector(".math-text__fallback")).not.toBeInTheDocument();
  });

  it("benchmark 的混合文本没有裸露 LaTeX，并且所有公式都能被 KaTeX 解析", () => {
    for (const value of mixedTextCorpus()) {
      const tokens = tokenizeMathText(value);
      const plainText = tokens
        .filter((token) => token.kind === "text")
        .map((token) => token.value)
        .join("");

      expect(plainText).not.toMatch(/\\[A-Za-z]+/);
      expect(plainText).not.toContain("\\(");
      expect(plainText).not.toContain("\\)");

      for (const token of tokens) {
        if (token.kind === "math") {
          expect(() => renderToString(token.value, { throwOnError: true, strict: "error" })).not.toThrow();
        }
      }
    }
  });

  it("逐步导读的独立公式均可严格渲染，并保留逐条来源及推断标记", () => {
    for (const step of propositionData.proof.steps) {
      expect(step.analysis.inferred).toBe(true);
      for (const source of [step.analysis, ...step.formulas, ...step.prerequisites]) {
        expect(source.evidence.length).toBeGreaterThan(0);
        expect(typeof source.inferred).toBe("boolean");
        expect(source.source_page.pdf.length).toBeGreaterThan(0);
        expect(source.source_page.printed).toEqual(source.source_page.pdf.map((page) => page + 132));
      }
      for (const formula of step.formulas) {
        expect(() => renderToString(formula.latex, { displayMode: true, throwOnError: true, strict: "error" })).not.toThrow();
      }
    }
    const formulas = propositionData.proof.steps.flatMap((step) => step.formulas);
    expect(formulas.find((formula) => formula.id === "vortex-equations-6")?.inferred).toBe(false);
    expect(formulas.find((formula) => formula.id === "small-cutoff-bound")?.inferred).toBe(true);
    expect(formulas.find((formula) => formula.id === "endpoint-normalization")?.inferred).toBe(true);
  });

  it("正文引用的公式均存在且唯一，每节的解释均保留来源和推断标记", () => {
    const { narrative, steps, logic_formulas } = propositionData.proof;
    const formulas = [...steps.flatMap((step) => step.formulas), ...logic_formulas];
    expect(new Set(formulas.map((formula) => formula.id)).size).toBe(formulas.length);
    expect(new Set(narrative.sections.map((section) => section.id)).size).toBe(narrative.sections.length);

    for (const source of [narrative.introduction, ...narrative.sections]) {
      expect(source.evidence.trim().length).toBeGreaterThan(0);
      expect(source.inferred).toBe(true);
      expect(source.source_page.pdf.length).toBeGreaterThan(0);
      expect(source.source_page.pdf.every((page) => Number.isInteger(page) && page > 0)).toBe(true);
      expect(source.source_page.printed).toEqual(source.source_page.pdf.map((page) => page + 132));
    }

    const formulaIds = narrative.sections.flatMap((section) =>
      section.blocks.flatMap((block) => block.type === "formula" ? [block.formula_id] : []),
    );
    expect(new Set(formulaIds).size).toBe(formulaIds.length);
    expect(formulaIds).toEqual(expect.arrayContaining([
      "vortex-equations-6", "eliminated-parameter-26", "small-cutoff-bound",
      "equation-29", "equation-30", "definition-17", "endpoint-normalization", "proof-closing-chain",
    ]));
    for (const formulaId of formulaIds) {
      expect(formulas.filter((formula) => formula.id === formulaId)).toHaveLength(1);
    }
    expect(formulas.find((formula) => formula.id === "vortex-equations-6")?.source_page).toEqual({
      pdf: [6], printed: [138],
    });
  });
});
